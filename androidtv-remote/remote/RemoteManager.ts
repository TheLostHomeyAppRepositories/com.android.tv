import tls from 'tls';
import RemoteMessageManager from './RemoteMessageManager';
import EventEmitter from 'events';
import type Homey from 'homey/lib/Homey';
import apps from './apps';

class RemoteManager extends EventEmitter {
  private host: string;
  private port: number;
  private certs: { key: string | undefined; cert: string | undefined };
  private client: tls.TLSSocket | undefined;
  private chunks: Buffer;
  private error: NodeJS.ErrnoException | null;
  private readonly maxTimeout: number;
  private readonly baseTimeout: number;
  private reconnectAttempts: number = 0;
  private remoteMessageManager: RemoteMessageManager;
  private reconnectTimeout: number | NodeJS.Timeout | null = null;
  private connecting: boolean = false;
  private destroyed: boolean = false;
  private homey: Homey;

  constructor(
    host: string,
    port: number,
    certs: {
      key: string | undefined;
      cert: string | undefined;
    },
    homey: Homey,
    timeout: number = 1000,
    manufacturer: string = 'unknown',
    model: string = 'unknown',
  ) {
    super();
    this.host = host;
    this.port = port;
    this.certs = certs;
    this.chunks = Buffer.from([]);
    this.error = null;
    this.maxTimeout = timeout;
    this.baseTimeout = Math.min(1000 * 5, timeout);
    this.remoteMessageManager = new RemoteMessageManager(manufacturer, model);
    this.remoteMessageManager.on('log.debug', (...args) => this.emit('log.debug', '[RemoteMessageHandler]', ...args));
    this.homey = homey;
  }

  async start(): Promise<void> {
    if (this.destroyed || this.connecting) {
      return;
    }

    this.teardownSocket();
    this.connecting = true;
    this.error = null;

    const options: tls.ConnectionOptions = {
      key: this.certs.key,
      cert: this.certs.cert,
      port: this.port,
      host: this.host,
      rejectUnauthorized: false,
    };

    this.emit('log.debug', 'Start Remote Connect');

    let socket: tls.TLSSocket;
    try {
      socket = tls.connect(options, () => {
        //this.emit('log.debug', "Remote connected")
      });
    } catch (error) {
      // A synchronous throw (e.g. a malformed stored certificate) leaves no socket
      // and no close event, so recover into the backoff loop explicitly.
      this.emit('log.error', 'Remote connect failed', error);
      this.error = error as NodeJS.ErrnoException;
      this.connecting = false;
      this.scheduleReconnect();
      return;
    }
    this.client = socket;

    socket.on('timeout', () => {
      this.emit('log.debug', 'timeout');
      socket.destroy();
    });

    // Ping is received every 5 seconds
    socket.setTimeout(1000 * 10);

    socket.on('secureConnect', () => {
      this.emit('log.debug', 'Remote secureConnect');
      this.connecting = false;
    });

    socket.on('data', data => {
      if (this.destroyed || socket !== this.client) {
        return;
      }
      try {
        const buffer = Buffer.from(data);
        this.chunks = Buffer.concat([this.chunks, buffer]);

        if (this.chunks.length > 0 && this.chunks.readInt8(0) === this.chunks.length - 1) {
          const message = this.remoteMessageManager.parse(this.chunks);

          if (!message.remotePingRequest) {
            this.emit('log.debug', 'Receive', JSON.stringify(message));
          }

          if (message.remoteConfigure) {
            socket.write(this.remoteMessageManager.createRemoteConfigure());
            // Application-level handshake complete: this connection is healthy.
            this.reconnectAttempts = 0;
            this.emit('ready');
          } else if (message.remoteSetActive) {
            socket.write(this.remoteMessageManager.createRemoteSetActive(622));
          } else if (message.remotePingRequest) {
            socket.write(this.remoteMessageManager.createRemotePingResponse(message.remotePingRequest.val1));
          } else if (message.remoteImeKeyInject) {
            const appId = message.remoteImeKeyInject.appInfo.appPackage;
            this.emit('current_app', apps[appId] ?? appId);
          } else if (message.remoteImeBatchEdit) {
            // No action
          } else if (message.remoteImeShowRequest) {
            // No action
          } else if (message.remoteVoiceBegin) {
            // No action
          } else if (message.remoteVoicePayload) {
            // No action
          } else if (message.remoteVoiceEnd) {
            // No action
          } else if (message.remoteStart) {
            this.emit('powered', message.remoteStart.started);
          } else if (message.remoteSetVolumeLevel) {
            this.emit('volume', {
              level: message.remoteSetVolumeLevel.volumeLevel,
              maximum: message.remoteSetVolumeLevel.volumeMax,
              muted: message.remoteSetVolumeLevel.volumeMuted,
            });
          } else if (message.remoteSetPreferredAudioDevice) {
            // No action
          } else if (message.remoteError) {
            if (message.remoteError?.message?.remoteConfigure) {
              this.emit('unpaired', message.remoteError);
            } else {
              this.emit('log.debug', 'Receive REMOTE ERROR');
              this.emit('error', message.remoteError);
            }
          } else if (message.remoteKeyInject) {
            this.emit('key', message.remoteKeyInject);
          } else {
            this.emit('log.log', 'What else ?');
          }
          this.chunks = Buffer.from([]);
        }
      } catch (error) {
        this.emit('log.error', 'RemoteManager on data error', error);
      }
    });

    socket.on('close', hasError => {
      if (this.destroyed || socket !== this.client) {
        return;
      }
      this.connecting = false;
      this.emit('close', { hasError: hasError, error: this.error });
      this.emit(
        hasError ? 'log.error' : 'log.info',
        'Remote Connection closed' + (hasError ? ' with error' + JSON.stringify(this.error) : ''),
      );

      this.scheduleReconnect();
    });

    socket.on('error', error => {
      if (this.destroyed || socket !== this.client) {
        return;
      }
      this.emit('log.error', error);
      this.error = error;
    });
  }

  private scheduleReconnect(): void {
    if (this.destroyed) {
      return;
    }
    if (this.reconnectTimeout) {
      this.homey.clearTimeout(this.reconnectTimeout);
    }
    const delay = Math.min(this.baseTimeout * 2 ** this.reconnectAttempts, this.maxTimeout);
    this.reconnectAttempts++;
    this.emit('log.debug', `Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    const emitError = (error: unknown): boolean => this.emit('log.error', error);
    this.reconnectTimeout = this.homey.setTimeout(() => this.start().catch(emitError), delay);
  }

  private teardownSocket(): void {
    if (this.reconnectTimeout) {
      this.homey.clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    this.connecting = false;
    this.chunks = Buffer.from([]);
    if (this.client) {
      this.client.removeAllListeners();
      // Keep an 'error' listener attached: a late error on a destroyed socket would
      // otherwise be an unhandled 'error' event and crash the process.
      this.client.on('error', () => {});
      this.client.destroy();
      this.client = undefined;
    }
  }

  sendPower(): void {
    this.client?.write(
      this.remoteMessageManager.createRemoteKeyInject(
        this.remoteMessageManager.RemoteDirection.SHORT,
        this.remoteMessageManager.RemoteKeyCode.KEYCODE_POWER,
      ),
    );
  }

  sendKey(key: number, direction: number): void {
    this.client?.write(this.remoteMessageManager.createRemoteKeyInject(direction, key));
  }

  sendAppLink(app_link: string): void {
    this.client?.write(this.remoteMessageManager.createRemoteRemoteAppLinkLaunchRequest(app_link));
  }

  sendVolume(volume: number): void {
    this.client?.write(this.remoteMessageManager.createRemoteAdjustVolumeLevel(volume));
  }

  stop(): void {
    this.destroyed = true;
    this.teardownSocket();
  }
}

export { RemoteManager };
