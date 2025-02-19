import EventEmitter from "events";
import Client from "./client";

class Channel extends EventEmitter {
  private readonly bus: Client;
  private readonly sourceId: string;
  private readonly destinationId: string;
  private readonly namespace: string;

  constructor(bus: Client, sourceId: string, destinationId: string, namespace: string) {
    super();

    this.bus = bus;
    this.sourceId = sourceId;
    this.destinationId = destinationId;
    this.namespace = namespace;

    const onmessage = (sourceId: string, destinationId: string, namespace: string, data: string | Uint8Array)=> {
      if(sourceId !== this.destinationId) return;
      if(destinationId !== this.sourceId && destinationId !== '*') return;
      if(namespace !== this.namespace) return;
      this.emit('message', JSON.parse(data as string), destinationId === '*');
    }

    const onclose = () => {
      this.bus.removeListener('message', onmessage);
    }

    this.bus.on('message', onmessage);
    this.once('close', onclose);
  }

  send(data: any) {
    this.bus.send(
        this.sourceId,
        this.destinationId,
        this.namespace,
        JSON.stringify({
          ...data,
          requestId: this.bus.requestId++
        })
    );
  };

  close() {
    this.emit('close');
  };
}

export default Channel;
