import Client from "./connection/client";
import tls from "node:tls";
import {Application, ConnectionMessage, ReceiverStatusMessage} from "./channel-message";
import MediaChannel from "./channels/MediaChannel";

export const enum NAMESPACES {
    CONNECTION = 'urn:x-cast:com.google.cast.tp.connection',
    HEARTBEAT = 'urn:x-cast:com.google.cast.tp.heartbeat',
    RECEIVER = 'urn:x-cast:com.google.cast.receiver',
    MEDIA = 'urn:x-cast:com.google.cast.media',
}

export type MediaUpdate = {
    // track
    title?: string | null,
    // artist
    subtitle?: string | null,
    // seems unused in Homey
    album?: string | null,
    image?: string | null,
    playing?: boolean | null,
}

export default class Chromecast {
    public readonly updateMedia: (update: MediaUpdate) => void;
    public readonly clearMedia: () => void;
    public readonly debug: (...args: unknown[]) => void;
    public readonly error: (...args: unknown[]) => void;

    private readonly connectionOptions: string | tls.ConnectionOptions;
    public client!: Client;
    public readonly subscribedMediaSession: Set<string> = new Set();

    private mediaChannel?: MediaChannel;

    constructor(
        connectionOptions: string | tls.ConnectionOptions,
        updateMedia: (update: MediaUpdate) => void,
        clearMedia: () => void,
        debug: (...args: unknown[]) => void = () => {},
        error: (...args: unknown[]) => void = () => {}
    ) {
        this.connectionOptions = connectionOptions;
        this.updateMedia = updateMedia;
        this.clearMedia = clearMedia;
        this.debug = debug;
        this.error = error;
    }

    handleError(err: any) {
        if (err?.errno === -113) {
            this.error("Chromecast unreachable")
        } else if (err?.errno === -111) {
            this.error("Chromecast connection refused")
        } else {
            this.error(err)
        }
    }

    async initialize() {
        this.client = new Client(this.debug);
        this.client.on("error", (err) => this.handleError(err));

        await this.client.connectAsync(this.connectionOptions);

        // create various namespace handlers
        const connection = this.client.createChannel(NAMESPACES.CONNECTION);
        const heartbeat = this.client.createChannel(NAMESPACES.HEARTBEAT);
        const receiver = this.client.createChannel(NAMESPACES.RECEIVER);
        this.mediaChannel = new MediaChannel(this)

        connection.on("message", (data, sourceId, destinationId) => {
            handleConnectionMessage(data as ConnectionMessage, sourceId, destinationId);
        })

        const handleConnectionMessage = (data: ConnectionMessage, sourceId: string, destinationId: string) => {
            if (data.type === 'CLOSE') {
                unsubscribeFromMediaNamespace(sourceId);
            } else {
                this.debug("Unknown connection message:", sourceId, destinationId, data);
            }
        }

        const unsubscribeFromMediaNamespace = (sessionId: string)=> {
            const removedSession = this.subscribedMediaSession.delete(sessionId);
            if (removedSession) {
                this.debug("Connected media sessions:", this.subscribedMediaSession)
                if (this.subscribedMediaSession.size === 0) {
                    this.clearMedia();
                }
            }
        }

        receiver.on('message', (data) => {
            handleCastReceiverMessage(data as ReceiverStatusMessage);
        });

        // establish virtual connection to the receiver
        connection.send({ type: 'CONNECT' });

        // start heartbeating
        setInterval(() => {
            heartbeat.send({ type: 'PING' });
        }, 5000);

        // get initial status
        receiver.send({ type: 'GET_STATUS' })

        const applicationHasMedia = (application: Application) => {
            if (application.namespaces === undefined) {
                return false;
            }
            for (const namespace of application.namespaces) {
                if (namespace.name === NAMESPACES.MEDIA) {
                    return true;
                }
            }
            return false;
        }

        const handleCastReceiverMessage = (message: ReceiverStatusMessage) => {
            if (message.type !== 'RECEIVER_STATUS' || message.status.applications === undefined) return;

            for (const application of message.status.applications) {
                if (applicationHasMedia(application)) {
                    subscribeToMediaNamespace(message, application);
                }
            }
        }

        const subscribeToMediaNamespace = (message: ReceiverStatusMessage, application: Application) => {
            if (this.subscribedMediaSession.has(application.sessionId)) return;
            this.subscribedMediaSession.add(application.sessionId);
            this.debug("Connected sessions:", this.subscribedMediaSession)
            sendMediaNamespaceConnect(message, application);
        }

        const sendMediaNamespaceConnect = (message: ReceiverStatusMessage, application: Application) => {
            const source = "client-" + message.requestId;
            const destination = application.sessionId;
            const data = JSON.stringify({ type: "CONNECT", requestId: this.client.requestId++ });
            this.client.send(NAMESPACES.CONNECTION, data, source, destination);
        }
    }
}
