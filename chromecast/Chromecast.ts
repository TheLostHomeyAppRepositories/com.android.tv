import Client from "./connection/client";
import tls from "node:tls";
import MediaChannel from "./channels/MediaChannel";
import ConnectionChannel from "./channels/ConnectionChannel";
import ReceiverChannel from "./channels/ReceiverChannel";

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

    private connectionChannel?: ConnectionChannel;
    private receiverChannel?: ReceiverChannel;
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
        this.connectionChannel = new ConnectionChannel(this);
        const heartbeat = this.client.createChannel(NAMESPACES.HEARTBEAT);
        this.receiverChannel = new ReceiverChannel(this);
        this.mediaChannel = new MediaChannel(this)

        // establish virtual connection to the receiver
        this.connectionChannel.connect();

        // start heartbeating
        setInterval(() => {
            heartbeat.send({ type: 'PING' });
        }, 5000);

        // get initial status
        this.receiverChannel.getStatus();
    }
}
