export interface Point {
    x: number;
    y: number;
}

export interface ScrcpyOptions {
    /**
     * scrcpy id since V 2.0
     */
    scid: string;
    version: "1.20" | "1.24" | "2.7" | `${number}.${number}` | `${number}.${number}.${number}`;
    /**
     * maxSize         (integer, multiple of 8) 0
     * Max width
     */
    maxSize: number,
    /**
     * maximum fps, 0 means not limited (supported after android 10)
     */
    maxFps: number;
    /**
     * flip the video
     */
    flip: boolean;
    /**
     * 
     */
    bitrate: number,
    /**
     * lock screen orientation, LOCK_VIDEO_ORIENTATION_*
     */
    lockedVideoOrientation: number;

    /**
     * use "adb forward" instead of "adb tunnel"
     */
    tunnelForward: boolean,
    tunnelDelay: number,
    /**
     * "width:height:x:y" or '-'
     * Crop the device screen on the server.
     * The values are expressed in the device natural orientation (typically,
     * portrait for a phone, landscape for a tablet). Any --max-size value is
     * cmoputed on the cropped size.
     */
    crop: string,
    sendFrameMeta: boolean,
    /**
     * set Control added in scrcpy 1.9
     */
    control: boolean;
    displayId: number,
    showTouches: boolean;
    stayAwake: boolean;
    codecOptions: string;
    encoderName: 'OMX.qcom.video.encoder.avc' | 'c2.android.avc.encoder' | 'OMX.google.h264.encoder' | string;
    powerOffScreenOnClose: boolean;
    /**
     * since scrcpy 1.21
     */
    clipboardAutosync?: boolean;
    /**
     * since scrcpy 1.22
     */
    downsizeOnError?: boolean;
    sendDeviceMeta?: boolean;
    sendDummyByte?: boolean;
    rawVideoStream?: boolean;
    /**
     * since scrcpy 1.23
     */
    cleanup?: boolean;
    /**
     * since scrcpy 2.0
     */
    noAudio?: boolean;
    /**
     * since scrcpy 2.0
     */
    // noControl?: boolean;
}

export interface H264Configuration {
    profileIndex: number;
    constraintSet: number;
    levelIndex: number;

    encodedWidth: number;
    encodedHeight: number;

    cropLeft: number;
    cropRight: number;

    cropTop: number;
    cropBottom: number;

    croppedWidth: number;
    croppedHeight: number;

    data: Uint8Array;
}


export interface VideoStreamFramePacket {
    // type: 'frame';
    keyframe?: boolean | undefined;
    pts?: bigint | undefined;
    data: Uint8Array;
    config?: H264Configuration;
}
