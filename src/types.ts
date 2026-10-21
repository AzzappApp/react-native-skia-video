import type { SkCanvas, SkImage } from 'react-native-skia';

/**
 * Represents a video frame.
 */
export type VideoFrame = {
  /**
   * The image of the frame, ready to be drawn with React Native Skia.
   *
   * The image is owned by the player (or composition player) that produced the
   * frame and only shows it until the next frame is produced: draw it, don't
   * keep it around or dispose it (use `image.makeRasterImageSync()` to keep a
   * copy).
   */
  image: SkImage;
  /**
   * The WebGPU texture the image samples, on Skia's device: for a WebGPU pass
   * that reads the frame (the same pixels as `image`, unrotated), without a
   * copy. Owned by the player like the image, and overwritten by the next
   * frame: sample it in the frame it was handed out with, don't destroy it.
   */
  texture: GPUTexture;
  /**
   * The width in pixels of the frame.
   */
  width: number;
  /**
   * The height in pixels of the frame.
   */
  height: number;
  /**
   * The rotation in degrees of the frame.
   */
  rotation: number;
};

/**
 * A frame as decoded by the native module: its pixels are in a native buffer,
 * turned into a `VideoFrame` by the library.
 */
export type DecodedFrame = {
  /**
   * The native buffer holding the pixels of the frame: a `CVPixelBufferRef`
   * on iOS and an `AHardwareBuffer*` on Android, as a `BigInt` pointer.
   * Undefined once the frame has been released: its pixels were already
   * copied by the library when the frame was first handed out.
   */
  buffer: bigint | undefined;
  /**
   * Identifies the frame among the frames of its producer (Android only): a
   * producer hands out its current frame again, with the same id, until a new
   * one is decoded, and the library copies a frame once. On iOS a frame
   * handed out again has no `buffer` anymore, released after its copy.
   */
  id?: number;
  /**
   * Android only: the sync fence (a sync_file descriptor, as a `BigInt`)
   * signaled once the decoder is done rendering the frame into `buffer`. The
   * buffer must not be read before. Owned by the frame.
   */
  readyFence?: bigint;
  /**
   * Android only: waits on the CPU for `readyFence`, for a device that cannot
   * wait for it on the GPU.
   */
  waitForReady?: () => void;
  /**
   * Android only, a frame in a buffer of its decoder, in the decoder's own
   * YUV layout: the region of `buffer` holding the frame (decoders pad their
   * buffers) and the clockwise rotation to apply to it. The library converts
   * it to RGB on the GPU, rotated and scaled to `width` × `height`.
   */
  yuv?: {
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
  };
  /**
   * Hands the native buffer back to the decoder, once its pixels were copied.
   * On Android, `fences` are the sync fences (sync_file descriptors, as
   * `BigInt`s, whose ownership is transferred) signaled once the buffer is
   * read: the decoder waits for them before rendering into the buffer again.
   */
  release?: (fences?: bigint[]) => void;
  /**
   * The width in pixels of the frame.
   */
  width: number;
  /**
   * The height in pixels of the frame.
   */
  height: number;
  /**
   * The rotation in degrees of the frame.
   */
  rotation: number;
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
export type BufferingRange = { start: number; duration: number };

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
  decodeNextFrame(): DecodedFrame | null;
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
  on(
    name: 'ready',
    listener: (dimensions: VideoDimensions) => void
  ): () => void;
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
  on(
    name: 'bufferingUpdate',
    listener: (loadedRanges: BufferingRange[]) => void
  ): () => void;
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
  on(
    name: 'playingStatusChange',
    listener: (isPlaying: boolean) => void
  ): () => void;
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
   * CAREFUL: this is read in the file's ENCODED orientation, the one
   * `naturalSize` reports, NOT the orientation the video is displayed in. A
   * clip filmed in portrait on a phone is a 1920x1080 file carrying a 90°
   * transform, and every API that hands out dimensions (a picker, a media
   * library) reports its DISPLAY size, 1080x1920. Passing that transposed
   * pair scales a 16:9 frame into a 9:16 buffer and hands back a squashed
   * picture. To simply bound the decoded size, use {@link maxLongSide}, which
   * is resolved against the track itself and cannot be given the wrong way
   * round.
   */
  resolution?: { width: number; height: number };
  /**
   * If provided, caps the LONG SIDE of the decoded frames: the decoder scales
   * the video down, keeping its aspect ratio, so that neither side exceeds
   * this many pixels (the scaled sizes are rounded to even numbers). A
   * smaller video is decoded as is. Ignored when {@link resolution} is set.
   *
   * This is the orientation-proof way to keep decoders from working bigger
   * than needed: the cap is resolved against the track's own frame size,
   * where the encoded orientation is known. A decoded frame becomes a
   * texture: a 4K one is 33 MB, so a preview a few hundred points wide has
   * every reason to ask for less.
   */
  maxLongSide?: number;
  /**
   * If set, the audio track of the video file will be played (during
   * playback) and mixed into the exported video (during export), following
   * the same time mapping as the video frames.
   * Defaults to false (video items are silent).
   */
  audio?: boolean | { volume?: number };
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
  /**
   * A fade in, in seconds from the start of the item: its volume ramps
   * linearly from 0 to `volume`, during playback and in the export.
   * Defaults to 0 (no fade).
   */
  fadeIn?: number;
  /**
   * A fade out, in seconds before the end of the item: its volume ramps
   * linearly from `volume` to 0. Defaults to 0 (no fade).
   */
  fadeOut?: number;
};

export type VideoCompositionItem =
  VideoCompositionVideoItem | VideoCompositionAudioItem;

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
   * An item is in the map around its time in the composition only, from one
   * second before it starts to one second after it ends: the resources of
   * its frames are released outside.
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
  decodeCompositionFrames(): Record<string, DecodedFrame>;
  /**
   * Disposes of the video composition frames extractor.
   */
  dispose(): void;
  /**
   * The current time in seconds.
   */
  readonly currentTime: number;
  /**
   * Whether the video composition frames extractor is currently playing.
   */
  readonly isPlaying: boolean;
  /**
   * Whether the video composition frames extractor is set to loop.
   */
  isLooping: boolean;
  /**
   * The master volume (0 to 1) of the composition's audio, on top of the
   * volume of each item. Set it rather than rebuilding the composition to
   * mute it: a new composition is a new player.
   */
  volume: number;
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
   * @returns The decoded video frames of the composition items.
   */
  decodeCompositionFrames(currentTime: number): Record<string, DecodedFrame>;
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
   * Hands out the buffer of the encoder for the next frame, to render into:
   * the `IOSurfaceRef` of the BGRA buffer the encoder converts every frame
   * from on iOS (`endFrame` appends an NV12 conversion of it, a BGRA copy
   * before iOS 16: the encoder may still be reading a frame when the next one
   * is drawn), the `AHardwareBuffer*` the encoder reads every frame from on
   * Android, as a `BigInt` pointer. It is the same buffer for every frame: it
   * can be imported once. The frame is encoded by `endFrame`.
   */
  beginFrame(): bigint;
  /**
   * Encodes the frame rendered into the buffer handed out by `beginFrame`.
   * The rendering must be complete (flushed synchronously).
   *
   * @param time The presentation time of the frame in seconds.
   * @param fences Android: the sync fences (`sync_file` descriptors, as
   * `BigInt`s) to wait for before reading the buffer, e.g. the ones React
   * Native WebGPU exports at the end of its access to the buffer. The encoder
   * takes ownership of them.
   */
  endFrame(time: number, fences?: bigint[]): void;
  /*
   * Finish writing the video to the output file.
   */
  finishWriting(): void;
  /**
   * Disposes of the video composition encoder.
   */
  dispose(): void;
};

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
   * The encoder name to use for the export.
   * @platform android
   */
  encoderName?: string | null;
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
   * @param maxLongSide If provided (and `resolution` isn't), caps the long
   * side of the decoded frames, keeping the aspect ratio.
   * @returns The video player.
   */
  createVideoPlayer: (
    uri: string,
    resolution?: { width: number; height: number } | null,
    maxLongSide?: number | null
  ) => VideoPlayer;
  /**
   * Creates a video composition frames extractor for the specified video composition.
   * @param composition The video composition.
   * @returns The video composition frames extractor.
   */
  createVideoCompositionFramesExtractor: (
    /**
     * The video composition to extract frames from.
     */
    composition: VideoComposition
  ) => VideoCompositionFramesExtractor;
  /**
   * Creates a synchronous video composition frames extractor for the specified video composition.
   * @param composition The video composition.
   * @returns The video composition frames extractor.
   */
  createVideoCompositionFramesExtractorSync: (
    /**
     * The video composition to extract frames from.
     */
    composition: VideoComposition
  ) => VideoCompositionFramesExtractorSync;

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
    composition?: VideoComposition | null
  ) => VideoEncoder;
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
   * Returns the memory used by the process in bytes (iOS: physical footprint,
   * Android: total PSS), or null if unavailable. Slow on Android: meant for
   * benchmarks, not to be called per frame.
   *
   * Not part of the public API (exposed through `__RNSkiaVideoPrivateAPI`).
   */
  getMemoryFootprint: () => number | null;
  /**
   * Android: whether the composition decoders prepared from now on hand
   * their frames over in their own YUV buffers, converted to RGB on Skia's
   * device, rather than rendered into RGBA buffers with OpenGL. Needs Android
   * 10 and a device with the `opaque-ycbcr-android-for-external-texture`
   * feature. By default, enabled when Skia's device has it.
   *
   * Not part of the public API (exposed through `__RNSkiaVideoPrivateAPI`).
   */
  setYUVFramesEnabled?: (enabled: boolean) => void;
  /**
   * Android: tells the native side whether Skia's device can sample the YUV
   * buffers of the decoders (see `setYUVFramesEnabled`). Called by the
   * library itself.
   *
   * Not part of the public API.
   */
  setYUVFramesSupported?: (supported: boolean) => void;
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
   * Given a set of encoder configurations,
   * returns the closest supported configurations by the platform encoders.
   *
   * @param width The width of the video.
   * @param height The height of the video.
   * @param frameRate The frame rate of the video in frames per second.
   * @param bitRate The bit rate of the video in bits per second.
   */
  getValidEncoderConfigurations(
    width: number,
    height: number,
    frameRate: number,
    bitRate: number
  ):
    | {
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
      }[]
    | null;
};
