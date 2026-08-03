import {
  createWorkletRuntime,
  runOnRuntime,
  scheduleOnRN,
} from 'react-native-worklets';
import { Skia, BlendMode } from '@shopify/react-native-skia';
import type { SkSurface } from '@shopify/react-native-skia';
import type {
  ExportOptions,
  FrameDrawer,
  VideoComposition,
  VideoEncoder,
  VideoCompositionFramesExtractorSync,
} from './types';
import RNSkiaVideoModule from './RNSkiaVideoModule';
import { createSynchronizable } from 'react-native-worklets';

const Promise = global.Promise;

const DEFAULT_AUDIO_BIT_RATE = 128000;
const DEFAULT_AUDIO_SAMPLE_RATE = 44100;
const DEFAULT_AUDIO_CHANNEL_COUNT = 2;

/**
 * Exports a video composition to a video file.
 *
 * @returns A promise that resolves when the export is complete.
 */
export const exportVideoComposition = async <T = undefined>({
  videoComposition,
  drawFrame,
  beforeDrawFrame,
  afterDrawFrame,
  onProgress,
  ...options
}: {
  /**
   * The video composition to export.
   */
  videoComposition: VideoComposition;
  /**
   * The function used to draw the video frames.
   */
  drawFrame: FrameDrawer<T>;
  /**
   * A function that is called before drawing each frame.
   * The return value will be passed to the drawFrame function as context.
   *
   * @returns The context that will be passed to the drawFrame function.
   */
  beforeDrawFrame?: () => T;
  /**
   * A function that is called after drawing each frame.
   * @param context The context returned by the beforeDrawFrame function.
   */
  afterDrawFrame?: (context: T) => void;
  /**
   * A signal used to cancel the export operation. If the signal is aborted, the promise will be rejected with an AbortError.
   */
  abortSignal?: AbortSignal;
  /**
   * A callback that is called when a frame is drawn.
   * @returns
   */
  onProgress?: (progress: {
    framesCompleted: number;
    nbFrames: number;
  }) => void;
} & ExportOptions): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    if (options.abortSignal?.aborted) {
      reject(new Error('AbortError'));
      return;
    }
    const exportRuntime = createWorkletRuntime({
      name: 'RNSkiaVideoExportRuntime-' + performance.now(),
    });

    const cancelledShareable = createSynchronizable(false);
    const abortListener = () => {
      cancelledShareable.setBlocking(true);
      reject(new Error('AbortError'));
    };
    if (options.abortSignal) {
      options.abortSignal.addEventListener('abort', abortListener);
    }

    runOnRuntime(exportRuntime, () => {
      'worklet';

      let surface: SkSurface | null = null;
      let frameExtractor: VideoCompositionFramesExtractorSync | null = null;
      let encoder: VideoEncoder | null = null;
      const { width, height } = options;
      try {
        try {
          surface = Skia.Surface.MakeOffscreen(width, height);
          if (!surface) {
            throw new Error('Failed to create Skia surface');
          }

          encoder = RNSkiaVideoModule.createVideoEncoder(
            {
              ...options,
              audioBitRate: options.audioBitRate ?? DEFAULT_AUDIO_BIT_RATE,
              audioSampleRate:
                options.audioSampleRate ?? DEFAULT_AUDIO_SAMPLE_RATE,
              audioChannelCount:
                options.audioChannelCount ?? DEFAULT_AUDIO_CHANNEL_COUNT,
            },
            videoComposition
          );
          encoder.prepare();

          frameExtractor =
            RNSkiaVideoModule.createVideoCompositionFramesExtractorSync(
              videoComposition
            );
          frameExtractor.start();

          const nbFrames = videoComposition.duration * options.frameRate;
          const canvas = surface.getCanvas();
          const clearColor = Skia.Color('#00000000');
          for (let i = 0; i < nbFrames; i++) {
            if (cancelledShareable.getDirty()) {
              return;
            }
            const currentTime = i / options.frameRate;
            const frames = frameExtractor.decodeCompositionFrames(currentTime);
            canvas.drawColor(clearColor, BlendMode.Clear);
            const context = beforeDrawFrame?.() as any;
            drawFrame({
              context,
              canvas,
              videoComposition,
              currentTime,
              frames,
              width: options.width,
              height: options.height,
            });
            // Synchronous flush: block until the GPU is done rendering the
            // frame, since the encoder reads the surface's texture from its
            // own command queue / GL context.
            surface.flush(true);
            const texture = surface.getNativeTextureUnstable();
            encoder.encodeFrame(texture, currentTime);
            afterDrawFrame?.(context);
            if (onProgress) {
              scheduleOnRN(onProgress, {
                framesCompleted: i + 1,
                nbFrames,
              });
            }
          }
        } finally {
          frameExtractor?.dispose();
          surface?.dispose();
        }

        encoder!.finishWriting();
      } catch (e) {
        scheduleOnRN(reject, e);
        return;
      } finally {
        encoder?.dispose();
      }
      scheduleOnRN(resolve, undefined);
    })();
  });
