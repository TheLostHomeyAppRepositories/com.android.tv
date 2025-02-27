import Channel from "../connection/channel";
import Chromecast, {NAMESPACES} from "../Chromecast";
import {ConnectionMessage} from "../channel-message";

export default class ConnectionChannel {
    private readonly channel: Channel;

    constructor(
        private readonly chromecast: Chromecast,
    ) {
        this.channel = chromecast.client.createChannel(NAMESPACES.CONNECTION);
        this.channel.on("message", (data, sourceId, destinationId) => {
            this.handleMessage(data as ConnectionMessage, sourceId, destinationId);
        });
    }

    public connect(): void {
        this.channel.send({ type: 'CONNECT' });
    }

    private handleMessage = (data: ConnectionMessage, sourceId: string, destinationId: string): void => {
        if (data.type === 'CLOSE') {
            this.chromecast.removeMediaSession(sourceId);
        } else {
            this.chromecast.debug("Unknown connection message:", sourceId, destinationId, data);
        }
    };
}
