import Client from "./connection/client";
import tls from "node:tls";
import {Application, ReceiverStatusMessage} from "./channel-message";

export default class Chromecast {
    private readonly debug: (...args: unknown[]) => void;
    private readonly connectionOptions: string | tls.ConnectionOptions;

    constructor(connectionOptions: string | tls.ConnectionOptions, debug: (...args: unknown[]) => void = () => {}) {
        this.connectionOptions = connectionOptions;
        this.debug = debug;
    }

    async initialize() {
        const debug = this.debug;
        const client = new Client(debug);

        await client.connectAsync(this.connectionOptions);

        // create various namespace handlers
        const connection = client.createChannel('sender-0', 'receiver-0', 'urn:x-cast:com.google.cast.tp.connection');
        const heartbeat = client.createChannel('sender-0', 'receiver-0', 'urn:x-cast:com.google.cast.tp.heartbeat');
        const receiver = client.createChannel('sender-0', 'receiver-0', 'urn:x-cast:com.google.cast.receiver');
        const media = client.createChannel('sender-0', 'receiver-0', 'urn:x-cast:com.google.cast.media');

        // display receiver status updates
        receiver.on('message', (data) => {
            // debug("Receiver data:", JSON.stringify(data));
            handleCastReceiverMessage(data);
        });

        media.on('message', (data) => {
            debug("Media data:", JSON.stringify(data, undefined, 2));
        })

        // establish virtual connection to the receiver
        connection.send({ type: 'CONNECT' });

        // start heartbeating
        setInterval(() => {
            heartbeat.send({ type: 'PING' });
        }, 5000);

        // get initial status
        receiver.send({ type: 'GET_STATUS' })

        const applicationHasMedia = (application: Application) => {
            for (const namespace of application.namespaces) {
                if (namespace.name === 'urn:x-cast:com.google.cast.media') {
                    return true;
                }
            }
            return false;
        }

        const handleCastReceiverMessage = (message: ReceiverStatusMessage) => {
            if (message.status.applications === undefined) return;

            for (const application of message.status.applications) {
                if (applicationHasMedia(application)) {
                    subscribeToMediaNamespace(message, application);
                }
            }
        }

        const subscribeToMediaNamespace = (message: ReceiverStatusMessage, application: Application) => {
            const source = "client-" + message.requestId;
            const destination = application.sessionId;
            const data = JSON.stringify({ type: "CONNECT", requestId: client.requestId++ });
            client.send(source, destination, 'urn:x-cast:com.google.cast.tp.connection', data);
        }
    }
}
