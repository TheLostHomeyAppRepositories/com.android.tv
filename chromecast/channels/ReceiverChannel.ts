import Chromecast, {NAMESPACES} from "../Chromecast";
import Channel from "../connection/channel";
import {Application, ReceiverStatusMessage} from "../channel-message";

export default class ReceiverChannel {
    private readonly chromecast: Chromecast;
    private readonly channel: Channel;

    constructor(
        chromecast: Chromecast,
    ) {
        this.chromecast = chromecast;
        this.channel = this.chromecast.client.createChannel(NAMESPACES.RECEIVER);
        this.channel.on('message', (data) => {
            this.handleCastReceiverMessage(data as ReceiverStatusMessage);
        });
    }

    public getStatus() {
        this.channel.send({ type: 'GET_STATUS' })
    }

    private handleCastReceiverMessage = (message: ReceiverStatusMessage) => {
        if (message.type !== 'RECEIVER_STATUS' || message.status.applications === undefined) return;

        for (const application of message.status.applications) {
            if (this.applicationHasMedia(application)) {
                this.subscribeToMediaNamespace(message, application);
            }
        }
    }

    private applicationHasMedia = (application: Application) => {
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

    private subscribeToMediaNamespace = (message: ReceiverStatusMessage, application: Application) => {
        if (this.chromecast.subscribedMediaSession.has(application.sessionId)) return;
        this.chromecast.subscribedMediaSession.add(application.sessionId);
        this.chromecast.debug("Connected sessions:", this.chromecast.subscribedMediaSession)
        this.sendMediaNamespaceConnect(message, application);
    }

    private sendMediaNamespaceConnect = (message: ReceiverStatusMessage, application: Application) => {
        const source = "client-" + message.requestId;
        const destination = application.sessionId;
        const data = JSON.stringify({ type: "CONNECT", requestId: this.chromecast.client.requestId++ });
        this.chromecast.client.send(NAMESPACES.CONNECTION, data, source, destination);
    }
}
