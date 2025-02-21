type Namespace = { "name": string };

export type Application = {
    "appId": string,
    "appType": string,
    "displayName": string,
    "iconUrl": string,
    "isIdleScreen": boolean,
    "launchedFromCloud": boolean,
    "namespaces": Namespace[],
    "senderConnected": false,
    "sessionId": string,
    "statusText": string,
    "transportId": string,
    "universalAppId": string,
};

export type ReceiverStatusMessage = {
    "requestId": number,
    "status": {
        "applications"?: Application[],
        "isActiveInput": boolean,
        "isStandBy": boolean,
        "userEq": unknown,
        "volume": {
            "controlType": string,
            "level": number,
            "muted": boolean,
            "stepInterval": number
        }
    },
    "type": "RECEIVER_STATUS"
}

const enum ConnectionMessageType {
    CLOSE= 'CLOSE',
    CONNECT= 'CONNECT',
}

export type ConnectionMessage = {
    type: ConnectionMessageType,
}

export type MediaStatusMessage = {
    "requestId": number,
    "type": "MEDIA_STATUS",
    "status": (MediaIdleStatus | MediaStatus)[]
}

type MediaIdleStatus = {
    "mediaSessionId": number,
    "playerState": PlayerState.IDLE,
    "idleReason": IdleReason,
}

const enum PlayerState {
    IDLE = "IDLE",
    PLAYING = "PLAYING",
    PAUSED = "PAUSED",
    BUFFERING = "BUFFERING",
}

const enum IdleReason {
    CANCELLED = "CANCELLED",
    INTERRUPTED = "INTERRUPTED",
    FINISHED = "FINISHED",
    ERROR = "ERROR",
}

const enum StreamType {
    BUFFERED = "BUFFERED",
    LIVE = "LIVE",
    OTHER = "OTHER",
}

const enum RepeatMode {
    OFF = "REPEAT_OFF",
    ALL = "REPEAT_ALL",
    SINGLE = "REPEAT_SINGLE",
    ALL_AND_SHUFFLE,
}

const enum MetaDataType {
    GENERIC,
    MOVIE,
    TV_SHOW,
    MUSIC_TRACK,
    PHOTO,
    AUDIOBOOK_CHAPTER,
}

// https://developers.google.com/cast/docs/reference/web_sender/chrome.cast.media.Media
type MediaStatus = {
    "currentTime"?: number,
    "mediaSessionId": number,
    "sessionId": string,
    "playerState": PlayerState,
    "volume": {
        "level": number,
        "muted": boolean
    },
    "repeatMode": RepeatMode,
    "media": MediaInfo,
}

type MediaInfo = {
    "contentId": string,
    "streamType": StreamType,
    "metadata"?: MediaMetaData,
    "duration"?: number,
}

type MediaMetaData = {
    metadataType: MetaDataType
    images?: MediaImage[] | MediaImage,
    title?: string,
    subtitle?: string,
    studio?: string,
    episode?: number,
    season?: number,
    seriesTitle?: string,
    // deprecated for episode
    episodeNumber?: number,
    // deprecated for season
    seasonNumber?: number,
    // deprecated for title
    episodeTitle?: string,
    albumArtist?: string,
    albumName?: string,
    // track artist
    artist?: string,
    composer?: string,
    discNumber?: number,
    trackNumber?: number,
    songName?: string,
    // deprecated for artist
    artistName?: string,
    bookTitle?: string,
    chapterNumber?: number,
    chapterTitle?: string,
};

type MediaImage = {
    url: string,
    height?: number,
    width?: number,
}

