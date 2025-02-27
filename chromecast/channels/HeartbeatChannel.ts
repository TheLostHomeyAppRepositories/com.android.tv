import Chromecast, {NAMESPACES} from "../Chromecast";
import Channel from "../connection/channel";

const HEARTBEAT_INTERVAL = 5000;

export default class HeartbeatChannel {
    private readonly channel: Channel;
    private interval?: NodeJS.Timeout;

    constructor(
        private readonly chromecast: Chromecast,
    ) {
        this.channel = this.chromecast.client.createChannel(NAMESPACES.HEARTBEAT);
    }

    public start() {
        this.interval = this.chromecast.homey.setInterval(() => {
            this.channel.send({ type: 'PING' });
        }, HEARTBEAT_INTERVAL);
    }

    public stop() {
        this.chromecast.homey.clearInterval(this.interval);
    }
}
