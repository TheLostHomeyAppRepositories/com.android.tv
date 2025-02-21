import Client from "./connection/client";
import tls from "node:tls";
import {
    Application,
    ConnectionMessage,
    MediaIdleStatus,
    MediaImage,
    MediaStatus,
    MediaStatusMessage,
    PlayerState,
    ReceiverStatusMessage
} from "./channel-message";

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
    private readonly updateMedia: (update: MediaUpdate) => void;
    private readonly debug: (...args: unknown[]) => void;
    private readonly error: (...args: unknown[]) => void;
    private readonly connectionOptions: string | tls.ConnectionOptions;
    private client!: Client;
    private readonly subscribedMediaSession: Set<string> = new Set();

    constructor(
        connectionOptions: string | tls.ConnectionOptions,
        updateMedia: (update: MediaUpdate) => void,
        debug: (...args: unknown[]) => void = () => {},
        error: (...args: unknown[]) => void = () => {}
    ) {
        this.connectionOptions = connectionOptions;
        this.updateMedia = updateMedia;
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
        const debug = this.debug;
        this.client = new Client();
        this.client.on("error", (err) => this.handleError(err));

        await this.client.connectAsync(this.connectionOptions);

        // create various namespace handlers
        const connection = this.client.createChannel(NAMESPACES.CONNECTION);
        const heartbeat = this.client.createChannel(NAMESPACES.HEARTBEAT);
        const receiver = this.client.createChannel(NAMESPACES.RECEIVER);
        const media = this.client.createChannel(NAMESPACES.MEDIA);

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
                    clearMedia();
                }
            }
        }

        receiver.on('message', (data) => {
            handleCastReceiverMessage(data as ReceiverStatusMessage);
        });

        media.on('message', (data) => {
            handleMediaStatusMessage(data as MediaStatusMessage);
        })

        const handleMediaStatusMessage = (data: MediaStatusMessage) =>{
            if (data.type !== 'MEDIA_STATUS' || data.status.length === 0) return;

            for (const status of data.status) {
                if (status.playerState === PlayerState.IDLE) {
                    handleIdleMediaMessage(status as MediaIdleStatus);
                } else {
                    handleMediaMessage(status as MediaStatus);
                }
            }
        }

        const handleMediaMessage = (status: MediaStatus) => {
            this.debug("Media status:", status);

            const update: MediaUpdate = {};

            if (status.playerState === PlayerState.PLAYING) {
                update.playing = true;
            } else if (status.playerState === PlayerState.PAUSED) {
                update.playing = false;
            }

            const selectorPriorities = ["title", "episodeTitle", "songName", "chapterTitle", "trackNumber", "chapterNumber", "subtitle", "seriesTitle", "bookTitle", "artist", "artistName", "albumArtist", "composer", "episodeNumber", "episode"] as const;

            if (status.media?.metadata) {
                const metadata = status.media.metadata;

                for (let i = selectorPriorities.length - 1; i >= 0; i--) {
                    const selector = selectorPriorities[i];
                    if (metadata[selector] !== undefined) {
                        update.title = metadata[selector]?.toString();
                    }
                }

                for (let i = selectorPriorities.length - 1; i >= 0; i--) {
                    const selector = selectorPriorities[i];
                    if (metadata[selector] !== undefined && metadata[selector] !== update.title) {
                        update.subtitle = metadata[selector]?.toString();
                    }
                }

                update.album = metadata.albumName ?? metadata.discNumber?.toString() ?? metadata.studio;

                if (metadata.images !== undefined) {
                    if (Array.isArray(metadata.images)) {
                        const image: MediaImage | undefined = metadata.images[0]
                        if (image?.url) update.image = image.url;
                    } else {
                        if (metadata.images.url) update.image = metadata.images.url;
                    }
                }
            }

            if (update.title !== undefined || update.subtitle !== undefined || update.album !== undefined || update.image !== undefined) {
                update.title ??= null;
                update.subtitle ??= null;
                update.album ??= null;
                update.image ??= null;
            }

            this.updateMedia(update)
        }

        const handleIdleMediaMessage = (status: MediaIdleStatus) => {
            clearMedia();
        }

        const clearMedia = () => {
            this.updateMedia({
                title: null,
                subtitle: null,
                album: null,
                image: null,
                playing: null,
            })
        }

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

            this.debug("Receiver status:", JSON.stringify(message));

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
