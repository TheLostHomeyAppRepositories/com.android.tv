import {EventEmitter} from "events";
import util from "node:util";
import PacketStreamWrapper from "./packet-stream-wrapper";
import tls, {TLSSocket} from "node:tls";
import {extensions} from "./protocol";
import Channel from "./channel";
import CastMessage = extensions.api.cast_channel.CastMessage;
import ICastMessage = extensions.api.cast_channel.ICastMessage;
import PayloadType = extensions.api.cast_channel.CastMessage.PayloadType;
import ProtocolVersion = extensions.api.cast_channel.CastMessage.ProtocolVersion;
import {NAMESPACES} from "../Chromecast";

type ClientEvents = {
  connect: [];
  error: [err: Error];
  close: [];
  message: [namespace: string, data: string | Uint8Array, sourceId: string, destinationId: string];
}

class Client extends EventEmitter<ClientEvents> {
  private socket: TLSSocket | null;
  private ps: PacketStreamWrapper | null;
  private readonly debug: (...args: unknown[]) => void;
  requestId = 1;

  constructor(debug: (...args: unknown[]) => void = () => {}) {
    super();
    this.debug = debug;
    this.socket = null;
    this.ps = null;
  }

  connectAsync(options: string | tls.ConnectionOptions): Promise<void> {
    return new Promise(resolve => {
      this.connect(options, resolve);
    });
  }

  connect(options: string | tls.ConnectionOptions, callback?: () => void) {
    if(typeof options === 'string') {
      options = {
        host: options
      };
    }

    options.port = options.port ?? 8009;
    options.rejectUnauthorized = false;

    if(callback) this.once('connect', callback);

    this.debug('connecting to %s:%d ...', options.host, options.port);

    this.socket = tls.connect(options, () => {
      this.ps = new PacketStreamWrapper(this.socket!);
      this.ps.on('packet', this.onpacket);

      this.debug('connected');
      this.emit('connect');
    });

    this.socket.on('error', this.onerror);
    this.socket.once('close', this.onclose);
  }

  public close() {
    this.debug('closing connection ...');
    // using socket.destroy here because socket.end caused stalled connection
    // in case of dongles going brutally down without a chance to FIN/ACK
    this.socket?.destroy();
  }

  public send(namespace: string, data: string | Uint8Array, sourceId: string = 'sender-0', destinationId: string = 'receiver-0') {
    const messagePayload = Buffer.isBuffer(data) ? {
      payloadType: PayloadType.BINARY,
      payloadBinary: data as Uint8Array,
    } : {
      payloadType: PayloadType.STRING,
      payloadUtf8: data as string,
    };

    const message: ICastMessage = {
      protocolVersion: ProtocolVersion.CASTV2_1_0,
      sourceId: sourceId,
      destinationId: destinationId,
      namespace: namespace,
      ...messagePayload,
    };

    if (namespace !== NAMESPACES.HEARTBEAT) this.logMessage('send message:', message);

    const buf = CastMessage.encode(message).finish();
    this.ps?.send(buf);
  }

  public createChannel(namespace: string) {
    return new Channel(this, namespace);
  }

  private onpacket = (buf: Uint8Array) => {
    const message = CastMessage.decode(buf);

    if (message.namespace !== NAMESPACES.HEARTBEAT) this.logMessage('recv message:', message);

    if(message.protocolVersion !== ProtocolVersion.CASTV2_1_0) {
      this.emit('error', new Error('Unsupported protocol version: ' + message.protocolVersion));
      this.close();
      return;
    }

    this.emit('message',
        message.namespace,
        (message.payloadType === PayloadType.BINARY)
            ? message.payloadBinary
            : message.payloadUtf8,
        message.sourceId,
        message.destinationId,
    );
  };

  private onclose = () => {
    this.debug('connection closed');
    this.socket?.removeListener('error', this.onerror);
    this.socket = null;
    if (this.ps) {
      this.ps.removeListener('packet', this.onpacket);
      this.ps = null;
    }
    this.emit('close');
  };

  private onerror = (err: Error) => {
    this.debug('error: %s %j', err.message, err);
    this.emit('error', err);
  };

  private logMessage(log: string, message: ICastMessage) {
    this.debug(
        log,
        'protocolVersion=',
        message.protocolVersion,
        ', sourceId=',
        message.sourceId,
        ', destinationId=',
        message.destinationId,
        ', namespace=',
        message.namespace,
        ', data=',
        (message.payloadType === PayloadType.BINARY)
            ? util.inspect(message.payloadBinary)
            : message.payloadUtf8
    );
  }
}

export default Client;
