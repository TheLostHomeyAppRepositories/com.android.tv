import EventEmitter from 'events';
import protobufjs from 'protobufjs';
import * as path from 'path';
import RemoteMessage from './RemoteMessage';

const directory = __dirname;

class RemoteMessageManager extends EventEmitter {
  private root: protobufjs.Root;
  private RemoteMessage: protobufjs.Type;
  public RemoteKeyCode: { [key: string]: number };
  public RemoteDirection: { [key: string]: number };
  private readonly manufacturer: string | undefined;
  private readonly model: string | undefined;

  constructor(manufacturer: string | undefined = undefined, model: string | undefined = undefined) {
    super();
    this.root = protobufjs.loadSync(path.join(directory, 'remotemessage.proto'));
    this.RemoteMessage = this.root.lookupType('remote.RemoteMessage');
    this.RemoteKeyCode = this.root.lookupEnum('remote.RemoteKeyCode').values;
    this.RemoteDirection = this.root.lookupEnum('remote.RemoteDirection').values;
    this.manufacturer = manufacturer;
    this.model = model;
  }

  create(payload: Record<string, unknown>): Uint8Array {
    if (!payload.remotePingResponse) {
      this.emit('log.debug', 'Create remote', JSON.stringify(payload));
    }

    const errMsg = this.RemoteMessage.verify(payload);
    if (errMsg) {
      throw new Error(errMsg);
    }

    const message = this.RemoteMessage.create(payload);
    const array = this.RemoteMessage.encodeDelimited(message).finish();

    if (!payload.remotePingResponse) {
      this.emit('log.debug', 'Sending', JSON.stringify(message.toJSON()));
    }

    return array;
  }

  createRemoteConfigure(): Uint8Array {
    return this.create({
      remoteConfigure: {
        code1: 622,
        deviceInfo: {
          model: this.model,
          vendor: this.manufacturer,
          unknown1: 1,
          unknown2: '1',
          packageName: 'androidtv-remote',
          appVersion: '1.0.0',
        },
      },
    });
  }

  createRemoteSetActive(active: number): Uint8Array {
    return this.create({
      remoteSetActive: {
        active: active,
      },
    });
  }

  createRemotePingResponse(val1: number): Uint8Array {
    return this.create({
      remotePingResponse: {
        val1: val1,
      },
    });
  }

  createRemoteKeyInject(direction: number, keyCode: number): Uint8Array {
    return this.create({
      remoteKeyInject: {
        keyCode: keyCode,
        direction: direction,
      },
    });
  }

  createRemoteAdjustVolumeLevel(level: number): Uint8Array {
    return this.create({
      remoteSetVolumeLevel: {
        unknown1: 2,
        volumeLevelSet: level,
      },
    });
  }

  createRemoteResetPreferredAudioDevice(): Uint8Array {
    return this.create({
      remoteResetPreferredAudioDevice: {},
    });
  }

  createRemoteImeKeyInject(appPackage: string, status: number): Uint8Array {
    return this.create({
      remoteImeKeyInject: {
        textFieldStatus: status,
        appInfo: {
          appPackage: appPackage,
        },
      },
    });
  }

  createRemoteRemoteAppLinkLaunchRequest(appLink: string): Uint8Array {
    return this.create({
      remoteAppLinkLaunchRequest: {
        appLink: appLink,
      },
    });
  }

  parse(buffer: Uint8Array): RemoteMessage {
    return this.RemoteMessage.decodeDelimited(buffer) as RemoteMessage;
  }
}

export default RemoteMessageManager;
