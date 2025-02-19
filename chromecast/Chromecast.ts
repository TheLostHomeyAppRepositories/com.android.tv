import Client from "./connection/client";
import tls from "node:tls";

export default class Chromecast {
    private readonly debug: (...args: unknown[]) => void;
    private readonly connectionOptions: string | tls.ConnectionOptions;

    constructor(connectionOptions: string | tls.ConnectionOptions, debug: (...args: unknown[]) => void = () => {}) {
        this.connectionOptions = connectionOptions;
        this.debug = debug;
    }

    async initialize() {
        const debug = this.debug;
        const client = new Client();

        await client.connectAsync(this.connectionOptions);

        // create various namespace handlers
        const connection = client.createChannel('sender-0', 'receiver-0', 'urn:x-cast:com.google.cast.tp.connection');
        const heartbeat = client.createChannel('sender-0', 'receiver-0', 'urn:x-cast:com.google.cast.tp.heartbeat');
        const receiver = client.createChannel('sender-0', 'receiver-0', 'urn:x-cast:com.google.cast.receiver');
        const media = client.createChannel('sender-0', 'receiver-0', 'urn:x-cast:com.google.cast.media');

        // establish virtual connection to the receiver
        connection.send({ type: 'CONNECT' });

        // start heartbeating
        setInterval(() => {
            heartbeat.send({ type: 'PING' });
        }, 5000);

        // display receiver status updates
        receiver.on('message', (data) => {
            debug("Receiver data:", JSON.stringify(data));
        });

        media.on('message', (data) => {
            debug("Media data:", JSON.stringify(data));
        })
    }
}
