import EventEmitter from "events";
import Client from "./client";

type ChannelEvents = {
  close: [],
  message: [data: unknown, sourceId: string, destinationId: string]
}

class Channel extends EventEmitter<ChannelEvents> {
  private readonly bus: Client;
  private readonly namespace: string;

  constructor(bus: Client, namespace: string) {
    super();

    this.bus = bus;
    this.namespace = namespace;

    this.bus.on('message', this.onmessage);
    this.once('close', this.onclose);
  }

  public send(data: any) {
    this.bus.send(
        this.namespace,
        JSON.stringify({
          ...data,
          requestId: this.bus.requestId++
        })
    );
  }

  public close() {
    this.emit('close');
  }

  private onmessage = (namespace: string, data: string | Uint8Array, sourceId: string, destinationId: string)=> {
    if(namespace !== this.namespace) return;
    this.emit('message', JSON.parse(data as string), sourceId, destinationId);
  };

  private onclose = () => {
    this.bus.removeListener('message', this.onmessage);
  };
}

export default Channel;
