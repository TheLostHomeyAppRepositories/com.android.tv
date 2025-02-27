import EventEmitter from "events";
import {TLSSocket} from "node:tls";

const enum StreamState {
  WAITING_HEADER  = 0,
  WAITING_PACKET = 1,
}

type PacketStreamWrapperEvents = {
  packet: [buffer: Uint8Array]
}

class PacketStreamWrapper extends EventEmitter<PacketStreamWrapperEvents> {
  private readonly stream: TLSSocket;

  constructor(stream: TLSSocket) {
    super();
    this.stream = stream;

    let state = StreamState.WAITING_HEADER;
    let packetLength = 0;

    this.stream.on('readable', () => {
      // eslint-disable-next-line no-constant-condition
      while(true) {
        switch(state) {
          case StreamState.WAITING_HEADER:
            // eslint-disable-next-line no-case-declarations
            const header = stream.read(4);
            if(header === null) return;
            packetLength = header.readUInt32BE(0);
            state = StreamState.WAITING_PACKET;
            break;
          case StreamState.WAITING_PACKET:
            // eslint-disable-next-line no-case-declarations
            const packet = stream.read(packetLength);
            if(packet === null) return;
            this.emit('packet', packet);
            state = StreamState.WAITING_HEADER;
            break;
        }
      }
    });
  }

  send(buf: Uint8Array): void {
    const header = Buffer.alloc(4);
    header.writeUInt32BE(buf.length, 0);
    this.stream.write(Buffer.concat([header, buf]));
  }
}

export default PacketStreamWrapper;
