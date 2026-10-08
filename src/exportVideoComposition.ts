import {
  createWorkletRuntime,
  runOnRuntime,
  scheduleOnRN,
  type WorkletRuntime,
} from 'react-native-worklets';
import { Skia, BlendMode } from 'react-native-skia';
import type {
  ExportOptions,
  FrameDrawer,
  VideoComposition,
  VideoEncoder,
  VideoCompositionFramesExtractorSync,
} from './types';
import RNSkiaVideoModule from './RNSkiaVideoModule';
import { createSynchronizable } from 'react-native-worklets';
import {
  createFrameImporter,
  exportsSyncFdFences,
  getSharedDevice,
} from './gpu';

const Promise = global.Promise;

const DEFAULT_AUDIO_BIT_RATE = 128000;
const DEFAULT_AUDIO_SAMPLE_RATE = 44100;
const DEFAULT_AUDIO_CHANNEL_COUNT = 2;

// The standard abort behavior is to reject with `signal.reason`. React
// Native's AbortController polyfill (`abort-controller`) predates `reason`,
// and Hermes has no DOMException, so when no reason is available this falls
// back to the exact same error shape RN's own fetch (whatwg-fetch) produces
// on abort: an Error with name 'AbortError'.
const createAbortError = (signal?: AbortSignal): unknown => {
  const reason = (signal as { reason?: unknown } | undefined)?.reason;
  if (reason !== undefined) {
    return reason;
  }
  const error = new Error('Aborted');
  error.name = 'AbortError';
  return error;
};

let exportRuntime: WorkletRuntime | null = null;
const getExportRuntime = () => {
  if (exportRuntime == null) {
    exportRuntime = createWorkletRuntime({
      name: 'RNSkiaVideoExportRuntime',
    });
  }
  return exportRuntime;
};

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
  abortSignal,
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
    if (abortSignal?.aborted) {
      reject(createAbortError(abortSignal));
      return;
    }
    const cancelledSynchronizable = createSynchronizable(false);
    const abortListener = () => {
      abortSignal?.removeEventListener('abort', abortListener);
      cancelledSynchronizable.setBlocking(true);
      reject(createAbortError(abortSignal));
    };
    abortSignal?.addEventListener('abort', abortListener);
    // The listener must not outlive the export: it keeps the synchronizable
    // and this promise's scope alive through the caller's AbortSignal.
    const settleResolve = () => {
      abortSignal?.removeEventListener('abort', abortListener);
      resolve(undefined);
    };
    const settleReject = (error: unknown) => {
      abortSignal?.removeEventListener('abort', abortListener);
      reject(error);
    };

    const device = getSharedDevice();
    runOnRuntime(getExportRuntime(), () => {
      'worklet';

      let frameExtractor: VideoCompositionFramesExtractorSync | null = null;
      let encoder: VideoEncoder | null = null;
      const importer = createFrameImporter(device);
      try {
        let renderTexture: GPUTexture | null = null;
        let surface: ReturnType<typeof Skia.Surface.MakeFromGPUTexture> | null =
          null;
        try {
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

          // Skia renders the frames straight into the native buffer the
          // encoder reads from (an IOSurface on iOS, an AHardwareBuffer on
          // Android), imported in the GPU device Skia renders with.
          const renderTarget = encoder.renderTarget;
          if (!renderTarget) {
            throw new Error('Failed to get the encoder render target');
          }
          const memory = device.importSharedTextureMemory({
            handle: renderTarget.handle,
            label: 'RNSkiaVideoExportTarget',
          });
          const texture = memory.createTexture();
          renderTexture = texture;
          surface = Skia.Surface.MakeFromGPUTexture(texture);
          if (!surface) {
            throw new Error('Failed to create Skia surface');
          }

          frameExtractor =
            RNSkiaVideoModule.createVideoCompositionFramesExtractorSync(
              videoComposition
            );
          frameExtractor.start();

          const nbFrames = videoComposition.duration * options.frameRate;
          const canvas = surface.getCanvas();
          const clearColor = Skia.Color('#00000000');
          // Each frame runs inside a native autorelease pool: the worklet
          // thread never drains its own, so the ObjC objects autoreleased
          // per frame by Skia and AVFoundation would otherwise accumulate
          // for the lifetime of the app. (No-op on Android.)
          const runPooled =
            RNSkiaVideoModule.runWithAutoreleasePool ??
            ((fn: () => void) => fn());
          const currentSurface = surface;
          const currentExtractor = frameExtractor;
          const currentEncoder = encoder;
          for (let i = 0; i < nbFrames; i++) {
            if (cancelledSynchronizable.getDirty()) {
              return;
            }
            const currentTime = i / options.frameRate;
            runPooled(() => {
              const frames = importer.importFrames(
                currentExtractor.decodeCompositionFrames(currentTime)
              );
              // The whole frame is cleared below: the previous content of
              // the render target does not matter.
              memory.beginAccess(texture, false);
              let fences: number[] = [];
              try {
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
                // Synchronous flush: block until the GPU is done rendering
                // the frame, since the encoder reads the render target with
                // another API (CPU on iOS, OpenGL on Android).
                currentSurface.flush(true);
                afterDrawFrame?.(context);
              } finally {
                const state = memory.endAccess(texture);
                if (exportsSyncFdFences) {
                  fences = state.fences.map((fence) =>
                    Number(fence.fence.export().handle)
                  );
                }
              }
              currentEncoder.encodeFrame(currentTime, fences);
              if (onProgress) {
                scheduleOnRN(onProgress, {
                  framesCompleted: i + 1,
                  nbFrames,
                });
              }
            });
          }
        } finally {
          frameExtractor?.dispose();
          // Dispose the surface before destroying the texture it draws into.
          surface?.dispose();
          renderTexture?.destroy();
        }

        encoder!.finishWriting();
      } catch (e) {
        scheduleOnRN(settleReject, e);
        return;
      } finally {
        importer.dispose();
        encoder?.dispose();
      }
      scheduleOnRN(settleResolve);
    })();
  });
