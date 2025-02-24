import Channel from "../connection/channel";
import Chromecast, {NAMESPACES} from "../Chromecast";
import {ConnectionMessage} from "../channel-message";

export default class ConnectionChannel {
    private readonly chromecast: Chromecast;
    private readonly channel: Channel;


    constructor(
        chromecast: Chromecast,
    ) {
        this.chromecast = chromecast;
        this.channel = chromecast.client.createChannel(NAMESPACES.CONNECTION);
        this.channel.on("message", (data, sourceId, destinationId) => {
            this.handleConnectionMessage(data as ConnectionMessage, sourceId, destinationId);
        })
    }

    public connect() {
        this.channel.send({ type: 'CONNECT' });
    }

    private handleConnectionMessage = (data: ConnectionMessage, sourceId: string, destinationId: string) => {
        if (data.type === 'CLOSE') {
            this.unsubscribeFromMediaNamespace(sourceId);
        } else {
            this.chromecast.debug("Unknown connection message:", sourceId, destinationId, data);
        }
    }

    private unsubscribeFromMediaNamespace = (sessionId: string)=> {
        const removedSession = this.chromecast.subscribedMediaSession.delete(sessionId);
        if (removedSession) {
            this.chromecast.debug("Connected media sessions:", this.chromecast.subscribedMediaSession)
            if (this.chromecast.subscribedMediaSession.size === 0) {
                this.chromecast.clearMedia();
            }
        }
    }
}
