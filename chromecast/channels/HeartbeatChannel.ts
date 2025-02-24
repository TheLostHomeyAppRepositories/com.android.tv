import Chromecast, {NAMESPACES} from "../Chromecast";
import Channel from "../connection/channel";

const HEARTBEAT_INTERVAL = 5000;

export default class HeartbeatChannel {
    private readonly channel: Channel;

    constructor(
        private readonly chromecast: Chromecast,
    ) {
        this.channel = this.chromecast.client.createChannel(NAMESPACES.HEARTBEAT);
    }

    public start() {
        setInterval(() => {
            this.channel.send({ type: 'PING' });
        }, HEARTBEAT_INTERVAL);
    }
}
