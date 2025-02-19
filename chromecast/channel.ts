import EventEmitter from "events";
import Client from "./client";

function encode(data: any, encoding: string) {
  if(!encoding) return data;
  switch(encoding) {
    case 'JSON': return JSON.stringify(data);
    default: throw new Error('Unsupported channel encoding: ' + encoding);
  }
}

function decode(data: string | Uint8Array, encoding: string) {
  if(!encoding) return data;
  switch(encoding) {
    case 'JSON': return JSON.parse(data as string);
    default: throw new Error('Unsupported channel encoding: ' + encoding);
  }
}

class Channel extends EventEmitter {
  private readonly bus: Client;
  private readonly sourceId: string;
  private readonly destinationId: string;
  private readonly namespace: string;
  private readonly encoding: string;

  constructor(bus: Client, sourceId: string, destinationId: string, namespace: string, encoding: string) {
    super();

    this.bus = bus;
    this.sourceId = sourceId;
    this.destinationId = destinationId;
    this.namespace = namespace;
    this.encoding = encoding;

    const onmessage = (sourceId: string, destinationId: string, namespace: string, data: string | Uint8Array)=> {
      if(sourceId !== this.destinationId) return;
      if(destinationId !== this.sourceId && destinationId !== '*') return;
      if(namespace !== this.namespace) return;
      this.emit('message', decode(data, this.encoding), destinationId === '*');
    }

    const onclose = () => {
      this.bus.removeListener('message', onmessage);
    }

    this.bus.on('message', onmessage);
    this.once('close', onclose);
  }

  send(data: string | Uint8Array) {
    this.bus.send(
        this.sourceId,
        this.destinationId,
        this.namespace,
        encode(data, this.encoding)
    );
  };

  close() {
    this.emit('close');
  };
}

export default Channel;
