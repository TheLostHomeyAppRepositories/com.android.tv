// https://developers.google.com/cast/docs/media/messages

import Channel from "../connection/channel";
import Chromecast, {MediaUpdate, NAMESPACES} from "../Chromecast";
import {MediaImage, MediaMetaData, MediaStatus, MediaStatusMessage, PlayerState} from "../channel-message";

const TEXT_SELECTOR_PRIORITIES = ["title", "episodeTitle", "songName", "chapterTitle", "trackNumber", "chapterNumber", "subtitle", "seriesTitle", "bookTitle", "artist", "artistName", "albumArtist", "composer", "episodeNumber", "episode"] as const;

export default class MediaChannel {
    private readonly channel: Channel;

    constructor(
        private readonly chromecast: Chromecast,
    ) {
        this.channel = this.chromecast.client.createChannel(NAMESPACES.MEDIA);
        this.channel.on("message", (data) => this.handleMessage(data as MediaStatusMessage))
    }

    private handleMessage = (data: MediaStatusMessage) =>{
        if (data.type !== 'MEDIA_STATUS' || data.status.length === 0) return;

        for (const status of data.status) {
            if (status.playerState === PlayerState.IDLE) {
                this.handleIdleMessage();
            } else {
                this.handleMediaMessage(status as MediaStatus);
            }
        }
    }

    private handleIdleMessage = () => {
        this.chromecast.clearMedia();
    }

    private handleMediaMessage = (status: MediaStatus) => {
        const update: MediaUpdate = {};
        MediaChannel.setUpdateMetadata(status, update);
        MediaChannel.setUpdatePlaying(update, status);
        MediaChannel.setUpdateClear(update);
        this.chromecast.updateMedia(update)
    }

    private static setUpdateMetadata(status: MediaStatus, update: MediaUpdate) {
        if (status.media?.metadata) {
            const metadata = status.media.metadata;
            MediaChannel.setUpdateTitle(update, metadata);
            MediaChannel.setUpdateSubTitle(update, metadata);
            MediaChannel.setUpdateImageUrl(update, metadata);
            update.album = metadata.albumName ?? metadata.discNumber?.toString() ?? metadata.studio;
        }
    }

    private static setUpdatePlaying(update: MediaUpdate, status: MediaStatus) {
        if (status.playerState === PlayerState.PLAYING) {
            update.playing = true;
        } else if (status.playerState === PlayerState.PAUSED || status.playerState === PlayerState.IDLE) {
            update.playing = false;
        }
    }

    private static setUpdateClear(update: MediaUpdate) {
        if (update.title !== undefined || update.subtitle !== undefined || update.album !== undefined || update.image !== undefined) {
            update.title ??= null;
            update.subtitle ??= null;
            update.album ??= null;
            update.image ??= null;
        }
    }

    private static setUpdateTitle(update: MediaUpdate, metadata: MediaMetaData) {
        for (const selector of TEXT_SELECTOR_PRIORITIES) {
            if (metadata[selector] !== undefined) {
                update.title = metadata[selector]?.toString();
                break;
            }
        }
    }

    private static setUpdateSubTitle(update: MediaUpdate, metadata: MediaMetaData) {
        for (let selector of TEXT_SELECTOR_PRIORITIES) {
            if (metadata[selector] !== undefined && metadata[selector] !== update.title) {
                update.subtitle = metadata[selector]?.toString();
                break;
            }
        }
    }

    private static setUpdateImageUrl(update: MediaUpdate, metadata: MediaMetaData) {
        if (metadata.images !== undefined) {
            if (Array.isArray(metadata.images)) {
                const image: MediaImage | undefined = metadata.images[0]
                update.image = image?.url;
            } else if (metadata.images.url) {
                update.image = metadata.images.url;
            }
        }
    }
}
