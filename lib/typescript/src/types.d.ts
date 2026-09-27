import type { SkCanvas } from '@shopify/react-native-skia';
/**
 * Represents a video frame.
 *
 * Frames are transient: draw a frame in the tick it is handed to you. The
 * native side owns the frame's pixels and reclaims them once the frame has
 * been superseded by later decode calls, so a retained frame's `texture`
 * eventually becomes undefined — retaining a frame never leaks memory, but
 * it is not a way to keep its pixels either.
 */
export type VideoFrame = {
    /**
     * The native texture of the frame.
     *
     * Only valid until further frames have been decoded by the producing
     * player or extractor; undefined once the frame's pixels have been
     * reclaimed.
     */
    texture: unknown;
    /**
     * The width in pixels of the frame.
     */
    width: number;
    /**
     * The height in pixels of the frame.
     */
    height: number;
    /**
     * The rotation in degrees of the frame: how much to turn it clockwise to
     * show it upright. iOS frames, and Android frames in `direct` mode, come as
     * decoded, with the video's rotation; Android frames in `copy` mode are
     * drawn upright and have none. {@link drawVideoFrame} applies it.
     */
    rotation: number;
    /**
     * The part of the texture that is the picture, in pixels, when it is not
     * all of it: Android frames in `direct` mode are the decoder's own buffer,
     * often larger than the picture (1920x1088 for a 1080p H.264 stream).
     * {@link drawVideoFrame} draws only this part.
     */
    crop?: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
};
/**
 * Represents the dimensions of a video.
 */
export type VideoDimensions = {
    /**
     * The width in pixels of the video.
     */
    width: number;
    /**
     * The height in pixels of the video.
     */
    height: number;
    /**
     * The rotation in degrees of the video.
     */
    rotation: number;
};
/**
 * Represents a range of buffered data.
 */
export type BufferingRange = {
    start: number;
    duration: number;
};
/**
 * How decoded frames reach Skia.
 *
 * - `copy` (default): every decoded frame is copied on the GPU into one
 *   texture the player (or the item decoder) owns and reuses. A frame stays
 *   readable until the next one overwrites it. This is the historical
 *   behaviour.
 * - `direct`: the decoder's own pixel buffer is handed to Skia through a Metal
 *   texture view, with no per-frame copy and no GPU wait. Faster and lighter,
 *   but a frame is only valid for the tick it is handed out in: its `texture`
 *   becomes `undefined` once newer frames have been decoded.
 *
 * On Android, composition items honour it (the video player does not yet):
 * `copy` draws each frame, upright and resized, into a texture the item owns;
 * `direct` hands Skia the decoder's buffer as an external texture, larger than
 * its picture and not turned upright, valid until the item's next frame. Draw
 * frames with {@link drawVideoFrame} to handle both modes on both platforms.
 */
export type VideoTextureMode = 'copy' | 'direct';
/**
 * How rendered frames reach the video encoder during an export on iOS.
 *
 * - `copy` (default): each frame is copied on the GPU into a CPU readable
 *   texture, read back into a pixel buffer, then appended. The historical
 *   behaviour.
 * - `direct`: each frame is blitted once, on the GPU, straight into the
 *   encoder's pixel buffer. One full frame copy and one GPU wait less per
 *   frame.
 *
 * Ignored on Android.
 */
export type VideoEncoderMode = 'copy' | 'direct';
/**
 * The video player interface.
 */
export type VideoPlayer = {
    /**
     * Resumes playback of the video.
     */
    play(): void;
    /**
     * Pauses playback.
     */
    pause(): void;
    /**
     * Seeks to a position specified in seconds.
     * Once the seek is complete, the `seekComplete` event will be emitted.
     *
     * @param time The position in seconds to seek to.
     */
    seekTo(time: number): void;
    /**
     * Decodes the next frame of the video.
     * This method should only be called from the ui thread.
     *
     * @returns The next frame of the video.
     */
    decodeNextFrame(): VideoFrame;
    /**
     * The current time in seconds of the playback.
     */
    readonly currentTime: number;
    /**
     * The duration in seconds of the video.
     */
    readonly duration: number;
    /**
     * Indicates whether the video is currently playing.
     */
    readonly isPlaying: boolean;
    /**
     * Indicates whether the video is set to loop.
     */
    isLooping: boolean;
    /**
     * The volume of the video.
     * The value should be between 0 and 1.
     */
    volume: number;
    /**
     * The playback speed of the video.
     * The value should be greater than 0. 1.0 is normal speed, 2.0 is double speed, 0.5 is half speed.
     */
    playbackSpeed: number;
    /**
     * Disposes of the video player.
     */
    dispose(): void;
    /**
     * Events dispatched by the video player once the video is ready to play.
     */
    on(name: 'ready', listener: (dimensions: VideoDimensions) => void): () => void;
    /**
     * Events dispatched by the video player when the video starts buffering.
     */
    on(name: 'bufferingStart', listener: () => void): () => void;
    /**
     * Events dispatched by the video player when the video stops buffering.
     */
    on(name: 'bufferingEnd', listener: () => void): () => void;
    /**
     * Events dispatched by the video player when the buffered ranges are updated.
     */
    on(name: 'bufferingUpdate', listener: (loadedRanges: BufferingRange[]) => void): () => void;
    /**
     * Events dispatched by the video player when the video playback completes.
     */
    on(name: 'complete', listener: () => void): () => void;
    /**
     * Events dispatched by the video player when a seek operation completes.
     */
    on(name: 'seekComplete', listener: () => void): () => void;
    /**
     * Events dispatched by the video player when the playing status changes.
     */
    on(name: 'playingStatusChange', listener: (isPlaying: boolean) => void): () => void;
    /**
     * Events dispatched by the video player when an error occurs.
     */
    on(name: 'error', listener: (error: any) => void): () => void;
};
/**
 * Represents a video composition.
 */
export type VideoComposition = {
    /**
     * The items that make up the composition.
     */
    items: VideoCompositionItem[];
    /**
     * The duration in seconds of the composition.
     */
    duration: number;
    /**
     * Open each video item's decoder shortly before the item starts and close it
     * shortly after it ends, instead of all of them at prepare. For compositions
     * that play their items one after another: decoders and their frames are
     * held for a few items at a time rather than for all of them.
     *
     * An item reached by a seek, rather than by playing up to it, shows no frame
     * until its decoder has opened. The export always waits for it.
     */
    lazyDecoders?: boolean;
};
type VideoCompositionItemBase = {
    /**
     * The unique identifier of the item.
     */
    id: string;
    /**
     * The path to the media file.
     * only support local file path
     */
    path: string;
    /**
     * The start time in seconds of the item within the composition.
     */
    compositionStartTime: number;
    /**
     * The start time in seconds of the item within the media.
     */
    startTime: number;
    /**
     * The duration in seconds of the item.
     */
    duration: number;
};
/**
 * A video item of a composition. Produces frames passed to the `drawFrame`
 * function. Video items are silent by default; set `audio` to also play
 * the audio track of the video file.
 */
export type VideoCompositionVideoItem = VideoCompositionItemBase & {
    kind?: 'video';
    /**
     * If provided, the resolution to scale the video to.
     * If not provided, the original resolution of the video will be used.
     * Downscaling the video can improve performance.
     *
     * Given in the file's *encoded* orientation, which for a portrait clip is
     * the transpose of what it displays as — prefer `maxLongSide` unless an
     * exact pixel size is needed.
     */
    resolution?: {
        width: number;
        height: number;
    };
    /**
     * If provided, the longest side the frames are decoded at, keeping the
     * file's own aspect. Ignored when `resolution` is set, and never upscales.
     *
     * This is what playback costs in memory: frames are BGRA and the player
     * keeps four of them, so an uncapped 4K clip holds 133 MB of buffers however
     * small it is drawn. Resolved inside the decoder, the only place that knows
     * the encoded orientation — so unlike `resolution`, this cannot squash a
     * rotated clip.
     *
     * On Android the decoder still reads the whole picture and the cap sizes the
     * texture it is drawn into, which is what the item holds in memory.
     */
    maxLongSide?: number;
    /**
     * How this item's frames reach Skia, see {@link VideoTextureMode}.
     *
     * On Android, `direct` hands Skia the decoder's buffer as an external
     * texture: no copy, and no texture of the item's own, so `resolution` and
     * `maxLongSide` do not apply. The frame is then larger than its picture and
     * not turned upright: draw it with {@link drawVideoFrame}.
     *
     * @default 'copy'
     */
    textureMode?: VideoTextureMode;
    /**
     * If set, the audio track of the video file will be played (during
     * playback) and mixed into the exported video (during export), following
     * the same time mapping as the video frames.
     * Defaults to false (video items are silent).
     */
    audio?: boolean | {
        volume?: number;
    };
};
/**
 * An audio item of a composition. Does not produce frames; its audio track
 * is played during playback and mixed into the exported video during export.
 * The source file can be an audio file or a video file (in which case its
 * audio track is used).
 */
export type VideoCompositionAudioItem = VideoCompositionItemBase & {
    kind: 'audio';
    /**
     * The volume of the item, between 0 and 1.
     * Defaults to 1.
     */
    volume?: number;
};
export type VideoCompositionItem = VideoCompositionVideoItem | VideoCompositionAudioItem;
/**
 * Function that draws a video composition frame to a canvas.
 */
export type FrameDrawer<T = undefined> = (args: {
    /**
     * The context created by the `before` function in video composition player.
     * or in export video composition.
     */
    context: T;
    /**
     * The canvas to draw the frame to.
     */
    canvas: SkCanvas;
    /**
     * The current composition
     */
    videoComposition: VideoComposition;
    /**
     * The current time in seconds of the drawn frame.
     */
    currentTime: number;
    /**
     * The decoded video frames of the composition items.
     * Only video items produce frames; audio items never appear in this map.
     */
    frames: Record<string, VideoFrame>;
    /**
     * The expected width of the frame in pixels.
     */
    width: number;
    /**
     * The expected height of the frame in pixels.
     */
    height: number;
}) => void;
/**
 * The video composition frames extractor interface.
 */
export type VideoCompositionFramesExtractor = {
    /**
     * Prepares the video composition frames extractor for extracting the frames.
     */
    prepare(): void;
    /**
     * Starts extracting the frames of the video composition.
     */
    play(): void;
    /**
     * Pauses the extraction of the frames.
     */
    pause(): void;
    /**
     * Seeks to a position specified in seconds.
     * @param time The position in seconds to seek to.
     */
    seekTo(time: number): void;
    /**
     * Decodes the frames of the video composition items.
     * This method should only be called from the ui thread.
     *
     * @returns The decoded video frames of the composition items.
     */
    decodeCompositionFrames(): Record<string, VideoFrame>;
    /**
     * Disposes of the video composition frames extractor.
     */
    dispose(): void;
    /**
     * The current time in seconds.
     */
    readonly currentTime: number;
    /**
     * A counter incremented every time `decodeCompositionFrames` returned a new
     * frame for at least one item. Two equal values mean the frames did not
     * change in between.
     */
    readonly framesVersion: number;
    /**
     * Whether the video composition frames extractor is currently playing.
     */
    readonly isPlaying: boolean;
    /**
     * Whether the video composition frames extractor is set to loop.
     */
    isLooping: boolean;
    /**
     * Events dispatched by the video composition frames extractor when the extraction is ready.
     */
    on(name: 'ready', listener: () => void): () => void;
    /**
     * Events dispatched by the video composition frames extractor process completes.
     */
    on(name: 'complete', listener: () => void): () => void;
    /**
     * Events dispatched by the video composition frames extractor when an error occurs.
     */
    on(name: 'error', listener: (error: any) => void): () => void;
};
/**
 * The video composition sync extractor interface.
 */
export type VideoCompositionFramesExtractorSync = {
    /**
     * Starts extracting the frames of the video composition.
     */
    start(): void;
    /**
     * Decodes the frames until reaching the specified time.
     * This method will block the current thread until the frames are decoded.
     *
     * The returned frames are only valid until the next call: draw them and
     * flush the GPU synchronously (`surface.flush(true)`) before decoding
     * further frames.
     *
     * @returns The decoded video frames of the composition items.
     */
    decodeCompositionFrames(currentTime: number): Record<string, VideoFrame>;
    /**
     * Disposes of the video composition frames extractor.
     */
    dispose(): void;
};
/**
 * The video composition encoder interface.
 */
export type VideoEncoder = {
    /**
     * Prepares the video composition encoder for writing.
     */
    prepare(): void;
    /**
     * Encodes the video frame to the video composition.
     */
    encodeFrame(texture: unknown, time: number): void;
    finishWriting(): void;
    /**
     * Disposes of the video composition encoder.
     */
    dispose(): void;
};
/**
 * The video codec used to encode an export.
 *
 * `h264` is supported by every device this library runs on, and is what
 * playback and upload pipelines are universally built around. `hevc` produces
 * roughly the same quality at about half the bitrate, but is not available
 * everywhere — see {@link RNSkiaVideoModule.isEncodingSupported}.
 */
export type VideoCodec = 'h264' | 'hevc';
/**
 * The export options for a video composition.
 */
export type ExportOptions = {
    /**
     * The path to save the exported video.
     */
    outPath: string;
    /**
     * The width of the exported video in pixels.
     */
    width: number;
    /**
     * The height of the exported video in pixels.
     */
    height: number;
    /**
     * The frame rate of the exported video in frames per second.
     */
    frameRate: number;
    /**
     * The bit rate of the exported video in bits per second.
     */
    bitRate: number;
    /**
     * The video codec to encode with.
     *
     * Falls back to `h264` when the requested codec has no encoder on the
     * device, so passing `hevc` can never fail an export that `h264` would have
     * completed. Call {@link RNSkiaVideoModule.isEncodingSupported} first if the
     * choice is surfaced to a user, so the option can be hidden rather than
     * silently ignored.
     *
     * @default 'h264'
     */
    codec?: VideoCodec;
    /**
     * The encoder name to use for the export.
     *
     * Takes precedence over {@link codec}: naming an encoder selects it
     * directly, whatever codec it implements.
     *
     * @platform android
     */
    encoderName?: string | null;
    /**
     * How rendered frames reach the encoder, see {@link VideoEncoderMode}.
     *
     * @default 'copy'
     * @platform ios
     */
    encoderMode?: VideoEncoderMode;
    /**
     * The bit rate of the exported audio track in bits per second.
     * Only used if the composition contains audio.
     * @default 128000
     */
    audioBitRate?: number;
    /**
     * The sample rate of the exported audio track in Hz.
     * Only used if the composition contains audio.
     * @default 44100
     */
    audioSampleRate?: number;
    /**
     * The number of channels of the exported audio track (1 = mono, 2 = stereo).
     * Only used if the composition contains audio.
     * @default 2
     */
    audioChannelCount?: number;
};
export type RNSkiaVideoModule = {
    /**
     * Creates a video player for the specified video file.
     *
     * @param uri The path to the video file.
     * @param resolution If provided, the resolution to scale the video to.
     * If not provided, the original resolution of the video will be used.
     * Downscaling the video can improve performance.
     * @returns The video player.
     */
    createVideoPlayer: (uri: string, resolution?: {
        width: number;
        height: number;
    } | null, options?: {
        textureMode?: VideoTextureMode;
    } | null) => VideoPlayer;
    /**
     * Creates a video composition frames extractor for the specified video composition.
     * @param composition The video composition.
     * @returns The video composition frames extractor.
     */
    createVideoCompositionFramesExtractor: (
    /**
     * The video composition to extract frames from.
     */
    composition: VideoComposition) => VideoCompositionFramesExtractor;
    /**
     * Creates a synchronous video composition frames extractor for the specified video composition.
     * @param composition The video composition.
     * @returns The video composition frames extractor.
     */
    createVideoCompositionFramesExtractorSync: (
    /**
     * The video composition to extract frames from.
     */
    composition: VideoComposition) => VideoCompositionFramesExtractorSync;
    /**
     * Creates a video composition encoder for the specified export options.
     * @param options The export options for the video composition.
     * @param composition The video composition being exported; used to encode
     * the audio tracks of the composition items (if any).
     * @returns The video composition encoder.
     */
    createVideoEncoder: (
    /**
     * The export options for the video composition.
     */
    options: ExportOptions, 
    /**
     * The video composition being exported (used for audio encoding).
     */
    composition?: VideoComposition | null) => VideoEncoder;
    /**
     * Runs the given function inside an autorelease pool. Worklet runtime
     * threads never drain their autorelease pool, so any per-frame native
     * garbage created by code running there would otherwise accumulate for the
     * lifetime of the app.
     *
     * @platform ios
     */
    runWithAutoreleasePool?: <T>(fn: () => T) => T;
    /**
     * Returns the decoding capabilities of the current platform for the specified mimetype.
     *
     * @platform android
     * @param mimetype The mimetype of the video.
     */
    getDecodingCapabilitiesFor(mimetype: string): {
        /**
         * The maximum number of instances that can be decoded simultaneously.
         */
        maxInstances: number;
        /**
         * The maximum width of the frame that the decoder will produce.
         */
        maxWidth: number;
        /**
         * The maximum height of the frame that the decoder will produce.
         */
        maxHeight: number;
    } | null;
    /**
     * Whether the device can encode with the given codec.
     *
     * `h264` is always true. `hevc` depends on the hardware: an A10 or later on
     * iOS, and a device dependent answer on Android, where HEVC decoding is far
     * more common than HEVC encoding.
     *
     * Exports fall back to `h264` on their own when this returns false, so this
     * is for the UI — hiding or disabling a codec the device cannot honour is
     * better than accepting the choice and quietly ignoring it.
     *
     * @param codec The codec to test.
     */
    isEncodingSupported(codec: VideoCodec): boolean;
    /**
     * Given a set of encoder configurations,
     * returns the closest supported configurations by the platform encoders.
     *
     * @param width The width of the video.
     * @param height The height of the video.
     * @param frameRate The frame rate of the video in frames per second.
     * @param bitRate The bit rate of the video in bits per second.
     * @param codec The codec the export will encode with, defaulting to `h264`.
     * Pass the same value here and to {@link ExportOptions.codec}: the sizes and
     * frame rates an H.264 encoder accepts say nothing about what the HEVC one on
     * the same chip will take. A codec the device cannot encode falls back to
     * `h264`, as an export would.
     */
    getValidEncoderConfigurations(width: number, height: number, frameRate: number, bitRate: number, codec?: VideoCodec): {
        /**
         * The name of the encoder.
         * can be reused in the `exportVideoComposition` method.
         */
        encoderName: string;
        /**
         * Wether the encoder supports hardware acceleration.
         */
        hardwareAccelerated: boolean;
        /**
         * The width of the video.
         */
        width: number;
        /**
         * The height of the video.
         */
        height: number;
        /**
         * The frame rate of the video in frames per second.
         */
        frameRate: number;
        /**
         * The bit rate of the video in bits per second.
         */
        bitRate: number;
    }[] | null;
};
export {};
//# sourceMappingURL=types.d.ts.map