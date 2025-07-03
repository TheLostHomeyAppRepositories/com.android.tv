import Homey, { Device, DiscoveryResultMAC, DiscoveryResultMDNSSD, DiscoveryResultSSDP, Driver } from 'homey';
import type { LoggerInterface } from '../../lib/LoggerInterface';
import AndroidTVRemoteClient from './client';
import { Device as DeviceType, DeviceData, DeviceSettings } from './types';
import PairSession from 'homey/lib/PairSession';

class RemoteDriver extends Driver implements LoggerInterface {
  async onPair(session: PairSession): Promise<void> {
    let devices: Array<DeviceType> = [];
    const existingDevices: Array<Device> = this.getDevices();
    let pairingDevice: DeviceType | null = null;
    let pairingClient: AndroidTVRemoteClient | null = null;

    session.setHandler('showView', async (view: string) => {
      this.log('Show view', view);

      if (view === 'discover') {
        const discoveredDevices = this.getDiscoveredDevices();
        let hasDiscoveredDevices = false;
        devices = discoveredDevices.filter(item => {
          if (item === null) {
            return false;
          }

          hasDiscoveredDevices = true;

          return (
            existingDevices.filter(existingDevice => {
              return item.data.id === existingDevice.getData().id;
            }).length === 0
          );
        });

        if (devices.length > 0) {
          await session.showView('list_devices');
        } else {
          await session.showView('add_by_ip');

          if (hasDiscoveredDevices) {
            await session.emit('add_by_ip_hint', this.homey.__('pair.add_by_ip.no_new_devices_hint'));
          }
        }
      }

      if (view === 'authenticate') {
        if (pairingDevice === null) {
          await session.showView('list_devices');
          this.error('Pairing device not set');
          return;
        }

        pairingClient = this.getPairingClientByDevice(pairingDevice);

        await pairingClient.start();
      }
    });

    session.setHandler('list_devices', async (): Promise<DeviceType[]> => {
      return devices;
    });

    session.setHandler('list_devices_selection', async (devices: DeviceType[]) => {
      const device = devices.pop();

      if (device !== undefined) {
        pairingDevice = device;
      }
    });

    session.setHandler('pincode', async (code: Buffer) => {
      if (pairingClient === null) {
        this.error('Pairing client should not be null');
        return;
      }
      if (pairingDevice === null) {
        this.error('Pairing device should not be null');
        return;
      }

      this.log('Pincode submitted', code.join(''));

      const pairingResult = await pairingClient.sendCode(code.join(''));

      if (pairingResult) {
        pairingDevice.store.cert = await pairingClient.getCertificate();
        session.showView('add_device');
      } else {
        session.showView('discover');
      }

      return pairingResult;
    });

    session.setHandler('getDevice', async (): Promise<DeviceType> => {
      if (pairingDevice === null) {
        throw new Error('Pairing device not set');
      }

      return pairingDevice;
    });
  }

  async onRepair(session: PairSession, repairingDevice: Device): Promise<void> {
    // Argument session is a PairSocket, similar to Driver.onPair
    // Argument device is a Homey.Device that's being repaired

    this.log('Repairing device', repairingDevice.getName());

    const discoveredDevices = this.getDiscoveredDevices();
    const existingDevice = discoveredDevices.find(item => item.data.id === repairingDevice.getData().id);
    if (existingDevice) {
      // Update IP
      await repairingDevice.setSettings({ ip: existingDevice.settings.ip });
    }

    const pairingClient = this.getPairingClientByDevice({
      name: repairingDevice.getName(),
      data: repairingDevice.getData() as DeviceData,
      store: {},
      settings: repairingDevice.getSettings() as DeviceSettings,
    } as DeviceType);

    session.setHandler('showView', async (view: string) => {
      this.log('Show view', view);

      if (view === 'start_repair') {
        this.log('START PAIRING');

        pairingClient.on('secret', () => {
          this.log('Pairing client started, show authenticate view');
          session.showView('authenticate');
        });

        await pairingClient.start();
      }
    });

    session.setHandler('pincode', async (code: Buffer) => {
      if (pairingClient === null) {
        this.error('Pairing client should not be null');
        return;
      }
      if (repairingDevice === null) {
        this.error('Pairing device should not be null');
        return;
      }

      this.log('Pincode submitted', code.join(''));

      const pairingResult = await pairingClient.sendCode(code.join(''));

      if (pairingResult) {
        await repairingDevice.onUninit();
        await repairingDevice.setStoreValue('cert', await pairingClient.getCertificate());
        await repairingDevice.onInit();
        session.done();
      } else {
        session.showView('authenticate');
      }

      return pairingResult;
    });

    session.setHandler('disconnect', async () => {
      // Cleanup
    });
  }

  private getPairingClientByDevice(device: DeviceType): AndroidTVRemoteClient {
    return new AndroidTVRemoteClient(
      this,
      this.homey,
      device.settings.ip,
      device.store.cert,
      'androidtv-remote',
      6467,
      6466,
    );
  }

  private getDeviceByDiscoveryResult(discoveryResult: DiscoveryResultMDNSSD): DeviceType {
    return {
      name: this.getNameByMDNSDiscoveryResult(discoveryResult),
      data: {
        id: discoveryResult.id,
      },
      store: {
        cert: {
          key: undefined,
          cert: undefined,
        },
      },
      settings: {
        ip: discoveryResult.address,
      },
    };
  }

  private getNameByMDNSDiscoveryResult(discoveryResult: DiscoveryResultMDNSSD): string {
    let name: string = '';
    const txtKeys = Object.keys(discoveryResult.txt);
    const txtValues = Object.values(discoveryResult.txt);

    if (txtKeys.indexOf('fn')) {
      name = txtValues[txtKeys.indexOf('fn')];
    }

    return name;
  }

  private getDiscoveredDevices(): Array<DeviceType> {
    const discoveryResults = this.getDiscoveryStrategy().getDiscoveryResults();

    return Object.values(discoveryResults)
      .map(discoveryResult => {
        if (discoveryResult instanceof DiscoveryResultSSDP || discoveryResult instanceof DiscoveryResultMAC) {
          this.log('Incorrect discovery result type received.');
          return null;
        }

        return this.getDeviceByDiscoveryResult(discoveryResult);
      })
      .filter(device => device !== null)
      .map(discoveryResult => discoveryResult as DeviceType);
  }

  debug(...args: unknown[]): void {
    if (Homey.env.DEBUG !== '1') {
      return;
    }

    this.log('[debug]', ...args);
  }
}

module.exports = RemoteDriver;
