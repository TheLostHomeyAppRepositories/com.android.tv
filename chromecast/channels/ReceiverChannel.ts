import Chromecast, {NAMESPACES} from "../Chromecast";
import Channel from "../connection/channel";
import {Application, ReceiverStatusMessage} from "../channel-message";

export type ApplicationStatus = {
    idle: boolean,
    name: string,
    status: string,
}

export default class ReceiverChannel {
    private readonly channel: Channel;

    constructor(
        private readonly chromecast: Chromecast,
    ) {
        this.channel = this.chromecast.client.createChannel(NAMESPACES.RECEIVER);
        this.channel.on('message', (data) => this.handleMessage(data as ReceiverStatusMessage));
    }

    public getStatus() {
        this.channel.send({ type: 'GET_STATUS' })
    }

    private handleMessage = (message: ReceiverStatusMessage) => {
        if (message.type !== 'RECEIVER_STATUS' || message.status.applications === undefined) return;

        const applicationStatuses: ApplicationStatus[] = [];

        for (const application of message.status.applications) {
            applicationStatuses.push({
                idle: application.isIdleScreen,
                name: application.displayName,
                status: application.statusText
            })

            if (this.applicationHasMedia(application)) {
                this.subscribeToMediaNamespace(message, application);
            }
        }

        this.chromecast.setApplicationStatuses(applicationStatuses);
    }

    private applicationHasMedia = (application: Application) => {
        if (application.namespaces === undefined) return false;
        for (const namespace of application.namespaces) {
            if (namespace.name === NAMESPACES.MEDIA) {
                return true;
            }
        }
        return false;
    }

    private subscribeToMediaNamespace = (message: ReceiverStatusMessage, application: Application) => {
        const addedSession = this.chromecast.addMediaSession(application.sessionId);
        if (!addedSession) return;
        this.sendMediaNamespaceConnect(message, application);
    }

    private sendMediaNamespaceConnect = (message: ReceiverStatusMessage, application: Application) => {
        const source = "client-" + message.requestId;
        const destination = application.sessionId;
        const data = JSON.stringify({ type: "CONNECT", requestId: this.chromecast.client.requestId++ });
        this.chromecast.client.send(NAMESPACES.CONNECTION, data, source, destination);
    }
}
