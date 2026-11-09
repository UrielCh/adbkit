export interface Point {
    x: number;
    y: number;
}

export interface ScrcpyOptions {
    /**
     * scrcpy id since V 2.0
     */
    scid: string;
    version: "1.20" | "1.24" | "2.7" | "3.0" | "3.1" | "3.2" | "3.3" | "3.3.1" | "3.3.4" | "4.0" | "4.1" | "5.0" | "5.0.1" | `${number}.${number}` | `${number}.${number}.${number}`;
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
    /**
     * captureOrientation since scrcpy 3.0
     * e.g. "0", "90", "180", "270", "flip0", "@", "@0", "@90", etc.
     */
    captureOrientation?: string;
    /**
     * angle since scrcpy 3.0
     * Custom rotation angle in degrees
     */
    angle?: number;
    /**
     * newDisplay since scrcpy 3.0
     * Create and mirror a new virtual display, e.g. "1920x1080" or "1920x1080/420"
     */
    newDisplay?: string;
    /**
     * vdSystemDecorations since scrcpy 3.0
     * Toggle system decorations on virtual display (defaults to true on server)
     */
    vdSystemDecorations?: boolean;
    /**
     * vdDestroyContent since scrcpy 3.1
     * Whether to destroy virtual display content on close (defaults to true on server).
     * Set false to move apps to main display on close (--no-vd-destroy-content).
     */
    vdDestroyContent?: boolean;
    /**
     * displayImePolicy since scrcpy 3.2
     * Policy for displaying IME (soft keyboard) on secondary/virtual displays: "local", "fallback", or "hide"
     */
    displayImePolicy?: 'local' | 'fallback' | 'hide' | string;
    /**
     * audioSource since scrcpy 2.0 / 3.2
     * e.g. 'output', 'playback', 'mic', 'mic-unprocessed', 'mic-camcorder', etc.
     */
    audioSource?: 'output' | 'playback' | 'mic' | 'mic-unprocessed' | 'mic-camcorder' | 'mic-voice-recognition' | 'mic-voice-communication' | 'voice-call' | 'voice-call-uplink' | 'voice-call-downlink' | 'voice-performance' | string;
    /**
     * screenOffTimeout in seconds since scrcpy 3.0
     */
    screenOffTimeout?: number;
    /**
     * flexDisplay since scrcpy 4.0
     * Dynamically resize virtual display to match the client window size
     */
    flexDisplay?: boolean;
    /**
     * keepActive since scrcpy 4.0
     * Periodically signals user activity to prevent device screen from turning off
     */
    keepActive?: boolean;
    /**
     * minSizeAlignment since scrcpy 4.0 (1, 2, 4, 8, or 16)
     */
    minSizeAlignment?: 1 | 2 | 4 | 8 | 16 | number;
    /**
     * cameraZoom since scrcpy 4.0
     */
    cameraZoom?: number;
    /**
     * cameraTorch since scrcpy 4.0
     */
    cameraTorch?: boolean;
    /**
     * ignoreVideoEncoderConstraints since scrcpy 4.1
     * Ignore encoder size constraints entirely, including alignment
     */
    ignoreVideoEncoderConstraints?: boolean;
    /**
     * videoCodec since scrcpy 2.0 / 4.1
     * "h264", "h265", "av1", "vp8", "vp9"
     */
    videoCodec?: 'h264' | 'h265' | 'av1' | 'vp8' | 'vp9' | string;
    /**
     * Custom path to scrcpy-server jar file
     */
    jarPath?: string;
    /**
     * Whether to automatically download scrcpy-server binary if missing (default: true)
     */
    autoDownload?: boolean;
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

    data: Uint8Array; // the original data use to p[opulate this structure]
}


export interface VideoStreamFramePacket {
    // type: 'frame';
    keyframe?: boolean | undefined;
    pts?: bigint | undefined;
    data: Uint8Array;
    config?: H264Configuration;
}
