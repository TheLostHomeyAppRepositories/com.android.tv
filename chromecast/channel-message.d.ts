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
