import {CertificateGenerator} from './certificate/CertificateGenerator';
import {PairingManager} from './pairing/PairingManager';
import {RemoteManager} from './remote/RemoteManager';
import RemoteMessageManager from './remote/RemoteMessageManager';
import EventEmitter from 'events';
import type Homey from "homey/lib/Homey";

export class AndroidRemote extends EventEmitter {
    private readonly host: string;
    private cert: { key: string | undefined; cert: string | undefined };
    private readonly pairing_port: number;
    private readonly remote_port: number;
    private readonly service_name: string;
    private readonly timeout: number;
    private readonly manufacturer: string;
    private readonly model: string;
    private readonly homey: Homey;

    private pairingManager: PairingManager | undefined;
    private remoteManager: RemoteManager | undefined;

    constructor(
      host: string,
      options: {
        pairing_port?: number;
        remote_port?: number;
        service_name?: string;
        cert?: { key: string | undefined; cert: string | undefined };
        timeout?: number,
        manufacturer?: string,
        model?: string,
      },
      homey: Homey
    ) {
        super();
        this.host = host;
        this.cert = {
            key: options.cert?.key,
            cert: options.cert?.cert,
        };
        this.pairing_port = options.pairing_port ?? 6467;
        this.remote_port = options.remote_port ?? 6466;
        this.service_name = options.service_name ?? 'Service Name';
        this.timeout = options.timeout ?? 1000;
        this.manufacturer = options.manufacturer ?? 'unknown';
        this.model = options.model ?? 'unknown';
        this.homey = homey;
    }

    async start(): Promise<void> {
        if (!this.cert.key || !this.cert.cert) {
            this.cert = CertificateGenerator.generateFull(
                this.service_name,
                'CNT',
                'ST',
                'LOC',
                'O',
                'OU'
            );

            this.pairingManager = new PairingManager(this.host, this.pairing_port, this.cert, this.service_name, this.manufacturer, this.model);
            this.pairingManager.on('secret', () => this.emit('secret'));

            for (const logLevel of ['log', 'log.debug', 'log.info', 'log.error']) {
              this.pairingManager.on(logLevel, (...args) => this.emit(logLevel, `[Pairing:${this.host}]`, ...args));
            }

            const paired = await this.pairingManager.start()
                .catch((error) => {
                    this.emit('log.error', error);
                });

            if (!paired) {
                return;
            }
        }

        this.remoteManager = new RemoteManager(this.host, this.remote_port, this.cert, this.homey, this.timeout, this.manufacturer, this.model);

        this.remoteManager.on('powered', (powered) => this.emit('powered', powered));

        this.remoteManager.on('volume', (volume) => this.emit('volume', volume));

        this.remoteManager.on('current_app', (current_app) => this.emit('current_app', current_app));

        this.remoteManager.on('ready', () => this.emit('ready'));

        this.remoteManager.on('close', (data) => this.emit('close', data));

        this.remoteManager.on('unpaired', () => this.emit('unpaired'));

        for (const logLevel of ['log', 'log.debug', 'log.info', 'log.error']) {
          this.remoteManager.on(logLevel, (...args) => this.emit(logLevel, `[Manager:${this.host}]`, ...args));
        }

        await new Promise((resolve) => setTimeout(resolve, 1000));

        return await this.remoteManager.start().catch(error => {
            this.emit('log.error', error);
        });
    }

    sendCode(code: string): boolean | undefined {
        return this.pairingManager?.sendCode(code);
    }

    sendPower(): void {
        this.remoteManager?.sendPower();
    }

    sendAppLink(app_link: string): void {
        this.remoteManager?.sendAppLink(app_link);
    }

    sendKey(key: number, direction: number): void {
        this.remoteManager?.sendKey(key, direction);
    }

    sendVolume(volume: number): void {
        this.remoteManager?.sendVolume(volume);
    }

    getCertificate(): { key: string | undefined; cert: string | undefined } {
        return {
            key: this.cert.key,
            cert: this.cert.cert,
        };
    }

    stop(): void {
        this.remoteManager?.stop();
    }
}

const RemoteKeyCode = (new RemoteMessageManager).RemoteKeyCode;
const RemoteDirection = (new RemoteMessageManager).RemoteDirection;

export {RemoteKeyCode, RemoteDirection};

export default {
    AndroidRemote,
    CertificateGenerator,
    RemoteKeyCode,
    RemoteDirection,
};
