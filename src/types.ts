// @ts-ignore
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type { SkCanvas, SkSurface, Skia } from '@shopify/react-native-skia';

/**
 * Represents a video frame.
 */
export type VideoFrame = {
  /**
   * The memory address of the native buffer.
   * @see Skia.Image.MakeImageFromNativeBuffer
   */
  buffer: bigint | null;
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

export type VideoCompositionItem = {
  /**
   * The unique identifier of the item.
   */
  id: string;
  /**
   * The path to the video file.
   * only support local file path
   */
  path: string;
  /**
   * The start time in seconds of the item within the composition.
   */
  compositionStartTime: number;
  /**
   * The start time in seconds of the item within the video.
   */
  startTime: number;
  /**
   * The duration in seconds of the item.
   */
  duration: number;
  /**
   * If provided, the resolution to scale the video to.
   * If not provided, the original resolution of the video will be used.
   * Downscaling the video can improve performance.
   */
  resolution?: { width: number; height: number };
};

/**
 * Function that draws a video composition frame to a canvas.
 */
export type FrameDrawer = (args: {
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
export type VideoCompositionFramesSyncExtractor = {
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
  decodeCompositionFrames(currentTime: number): Record<string, VideoFrame>;
  /**
   * Disposes of the video composition frames extractor.
   */
  dispose(): void;
};

/**
 * The video composition encoder interface.
 */
export type VideoCompositionEncoder = {
  /**
   * Prepares the video composition encoder for writing.
   */
  prepare(): void;
  /**
   * Encodes the video frame to the video composition.
   */
  encodeFrame(texture: unknown, time: number): void;
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
  createVideoPlayer: (
    uri: string,
    resolution?: { width: number; height: number } | null
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
  createVideoCompositionFramesSyncExtractor: (
    /**
     * The video composition to extract frames from.
     */
    composition: VideoComposition
  ) => VideoCompositionFramesSyncExtractor;

  /**
   * Creates a video composition encoder for the specified export options.
   * @param options The export options for the video composition.
   * @returns The video composition encoder.
   */
  createVideoCompositionEncoder: (
    /**
     * The export options for the video composition.
     */
    options: ExportOptions
  ) => VideoCompositionEncoder;
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
