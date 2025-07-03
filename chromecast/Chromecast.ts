import Client, { ChromecastError } from './connection/client';
import tls from 'node:tls';
import MediaChannel from './channels/MediaChannel';
import ConnectionChannel from './channels/ConnectionChannel';
import ReceiverChannel from './channels/ReceiverChannel';
import HeartbeatChannel from './channels/HeartbeatChannel';
import type Homey from 'homey/lib/Homey';

export const enum NAMESPACES {
  CONNECTION = 'urn:x-cast:com.google.cast.tp.connection',
  HEARTBEAT = 'urn:x-cast:com.google.cast.tp.heartbeat',
  RECEIVER = 'urn:x-cast:com.google.cast.receiver',
  MEDIA = 'urn:x-cast:com.google.cast.media',
}

export type MediaUpdate = {
  // track
  title?: string | null;
  // artist
  subtitle?: string | null;
  // seems unused in Homey
  album?: string | null;
  image?: string | null;
  playing?: boolean | null;
};

export default class Chromecast {
  private readonly connectionOptions: string | tls.ConnectionOptions;
  public client!: Client;
  public readonly subscribedMediaSession: Set<string> = new Set();
  private destroyed: boolean = false;
  private reconnectTimeout: NodeJS.Timeout | null = null;

  private connectionChannel?: ConnectionChannel;
  private heartbeatChannel?: HeartbeatChannel;
  private receiverChannel?: ReceiverChannel;
  private mediaChannel?: MediaChannel;

  constructor(
    connectionOptions: string | tls.ConnectionOptions,
    readonly updateMedia: (update: MediaUpdate) => void,
    readonly debug: (...args: unknown[]) => void,
    readonly error: (...args: unknown[]) => void,
    readonly logMessages = false,
    readonly homey: Homey,
  ) {
    this.connectionOptions = connectionOptions;
    this.clearMedia();
  }

  handleClose(): void {
    if (this.destroyed) {
      return;
    }
    if (this.reconnectTimeout) {
      this.homey.clearTimeout(this.reconnectTimeout);
    }
    this.reconnectTimeout = this.homey.setTimeout(() => this.initialize(), 60 * 1000); // Reconnect after 1 minute
  }

  handleError(err: ChromecastError | Error): void {
    if (err instanceof Error) {
      this.error(err);
      return;
    }
    if (err?.errno === -113) {
      this.error('Chromecast unreachable');
      this.clearMedia();
    } else if (err?.errno === -111) {
      this.error('Chromecast connection refused');
      this.clearMedia();
    } else {
      this.error(err);
    }
  }

  clearMedia(): void {
    this.updateMedia({
      title: null,
      subtitle: null,
      album: null,
      image: null,
      playing: null,
    });
  }

  async initialize(): Promise<void> {
    this.client = new Client(this.logMessages ? this.debug : undefined);
    this.client.on('error', err => this.handleError(err));
    this.client.on('close', () => this.handleClose());

    await this.client.connectAsync(this.connectionOptions);

    this.connectionChannel = new ConnectionChannel(this);
    this.heartbeatChannel = new HeartbeatChannel(this);
    this.receiverChannel = new ReceiverChannel(this);
    this.mediaChannel = new MediaChannel(this);

    this.connectionChannel.connect();
    this.heartbeatChannel.start();
    this.receiverChannel.getStatus();
  }

  public addMediaSession(sessionId: string): boolean {
    if (this.subscribedMediaSession.has(sessionId)) {
      return false;
    }
    this.subscribedMediaSession.add(sessionId);
    this.debug('Connected sessions:', this.subscribedMediaSession);
    return true;
  }

  public removeMediaSession(sessionId: string): boolean {
    const removedSession = this.subscribedMediaSession.delete(sessionId);
    if (!removedSession) {
      return false;
    }
    if (this.subscribedMediaSession.size === 0) {
      this.clearMedia();
    }
    this.debug('Connected media sessions:', this.subscribedMediaSession);
    return true;
  }

  public close(): void {
    if (this.reconnectTimeout) {
      this.homey.clearTimeout(this.reconnectTimeout);
    }
    this.destroyed = true;
    return this.client.close();
  }
}
