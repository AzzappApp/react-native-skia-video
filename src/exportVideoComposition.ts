import {
  createWorkletRuntime,
  runOnRuntime,
  scheduleOnRN,
  type WorkletRuntime,
} from 'react-native-worklets';
import { AlphaType, BlendMode, ColorType, Skia } from 'react-native-skia';
import type {
  ImageInfo,
  SkCanvas,
  SkImage,
  SkSurface,
} from 'react-native-skia';
import { Platform } from 'react-native';
import type {
  GPUSharedTextureMemory,
  GPUSharedTextureMemoryEndAccessState,
} from 'react-native-webgpu';
import type {
  ExportOptions,
  FrameDrawer,
  VideoComposition,
  VideoEncoder,
  VideoCompositionFramesExtractorSync,
} from './types';
import RNSkiaVideoModule from './RNSkiaVideoModule';
import {
  createFrameImagesKey,
  getFrameImageContext,
  makeVideoFrames,
  releaseFrameImages,
} from './frameImages';
import { createSynchronizable } from 'react-native-worklets';

const Promise = global.Promise;

const DEFAULT_AUDIO_BIT_RATE = 128000;
const DEFAULT_AUDIO_SAMPLE_RATE = 44100;
const DEFAULT_AUDIO_CHANNEL_COUNT = 2;

// The pixel layout the encoders expect: the native layout of the platform's
// video buffers (CVPixelBuffer kCVPixelFormatType_32BGRA on iOS, OpenGL RGBA
// on Android).
const FRAME_COLOR_TYPE =
  Platform.OS === 'ios' ? ColorType.BGRA_8888 : ColorType.RGBA_8888;

// On Android the encoder hands out the same buffer for every frame (see
// `VideoEncoder.beginFrame`): it is imported once, and the encoder waits for
// the sync fences of each frame on the GPU.
const IS_ANDROID = Platform.OS === 'android';

// An encoder's frame buffer imported into Skia's device.
type ExportTarget = {
  handle: bigint;
  memory: GPUSharedTextureMemory;
  texture: GPUTexture;
  surface: SkSurface;
};

// `SkImage.readPixels` also accepts a destination array (4th argument), which
// is not part of its TypeScript signature: reading every frame into the same
// array avoids allocating width × height × 4 bytes per frame.
type ReadPixelsInto = (
  srcX: number,
  srcY: number,
  imageInfo: ImageInfo,
  dest: Uint8Array
) => Uint8Array | Float32Array | null;

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

    let frameImageContext: ReturnType<typeof getFrameImageContext>;
    try {
      frameImageContext = getFrameImageContext();
    } catch (error) {
      settleReject(error);
      return;
    }
    const framesKey = createFrameImagesKey();

    runOnRuntime(getExportRuntime(), () => {
      'worklet';

      let frameExtractor: VideoCompositionFramesExtractorSync | null = null;
      let encoder: VideoEncoder | null = null;
      const { width, height } = options;
      // Recycled across frames (outputImage) to avoid allocating a new JSI
      // object per frame.
      let snapshot: SkImage | undefined;
      // Android: the encoder's buffer, imported once (see IS_ANDROID).
      const targets: { reused: ExportTarget | null } = { reused: null };
      try {
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
          const currentEncoder = encoder;
          // Skia draws each frame directly into a buffer of the encoder.
          // Otherwise (an encoder without beginFrame) each frame is read back
          // to the CPU and handed to the encoder, which copies it into its own
          // buffers.
          const zeroCopy =
            currentEncoder.beginFrame != null &&
            currentEncoder.endFrame != null;

          let surface: SkSurface | null = null;
          if (!zeroCopy) {
            // Reuse a single offscreen surface across exports (per
            // dimensions). Disposing the surface is not enough to free its
            // GPU texture: the canvas wrapper returned by getCanvas() keeps
            // the surface alive until the runtime GC collects it, so creating
            // a fresh surface per export leaks its backing texture
            // (width × height × 4 bytes) on every run.
            const cache = globalThis as unknown as {
              __rnskvExportSurface?: SkSurface | null;
              __rnskvExportSurfaceWidth?: number;
              __rnskvExportSurfaceHeight?: number;
            };
            surface = cache.__rnskvExportSurface ?? null;
            if (
              surface == null ||
              cache.__rnskvExportSurfaceWidth !== width ||
              cache.__rnskvExportSurfaceHeight !== height
            ) {
              surface?.dispose();
              cache.__rnskvExportSurface = null;
              surface = Skia.Surface.MakeOffscreen(width, height);
              if (!surface) {
                throw new Error('Failed to create Skia surface');
              }
              cache.__rnskvExportSurface = surface;
              cache.__rnskvExportSurfaceWidth = width;
              cache.__rnskvExportSurfaceHeight = height;
            }
          }

          frameExtractor =
            RNSkiaVideoModule.createVideoCompositionFramesExtractorSync(
              videoComposition
            );
          frameExtractor.start();

          const nbFrames = videoComposition.duration * options.frameRate;
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
          const frameInfo: ImageInfo = {
            width,
            height,
            colorType: FRAME_COLOR_TYPE,
            alphaType: AlphaType.Premul,
          };
          const framePixels = zeroCopy
            ? null
            : new Uint8Array(width * height * 4);
          for (let i = 0; i < nbFrames; i++) {
            if (cancelledSynchronizable.getDirty()) {
              return;
            }
            const currentTime = i / options.frameRate;
            runPooled(() => {
              const frames = makeVideoFrames(
                frameImageContext,
                framesKey,
                currentExtractor.decodeCompositionFrames(currentTime)
              );
              const context = beforeDrawFrame?.() as any;
              const draw = (canvas: SkCanvas) => {
                canvas.drawColor(clearColor, BlendMode.Clear);
                drawFrame({
                  context,
                  canvas,
                  videoComposition,
                  currentTime,
                  frames,
                  width: options.width,
                  height: options.height,
                });
              };
              if (zeroCopy) {
                const handle = currentEncoder.beginFrame!();
                let target =
                  targets.reused?.handle === handle ? targets.reused : null;
                if (target == null) {
                  // iOS: the buffer is imported for this frame only: a
                  // texture kept over its IOSurface would keep it in use, so
                  // that the encoder's pool could never recycle it and would
                  // allocate a new buffer for every frame.
                  const memory =
                    frameImageContext.device.importSharedTextureMemory({
                      handle,
                    });
                  const texture = memory.createTexture();
                  target = {
                    handle,
                    memory,
                    texture,
                    surface: Skia.Surface.MakeFromGPUTexture(texture),
                  };
                  if (IS_ANDROID) {
                    targets.reused = target;
                  }
                }
                target.memory.beginAccess(target.texture, false);
                let accessState: GPUSharedTextureMemoryEndAccessState;
                try {
                  draw(target.surface.getCanvas());
                  // The encoder reads the buffer as soon as it is handed
                  // back: wait for the GPU to finish drawing into it.
                  target.surface.flush(true);
                } finally {
                  accessState = target.memory.endAccess(target.texture);
                  if (target !== targets.reused) {
                    target.surface.dispose();
                    // Releases the Metal texture over the IOSurface now
                    // rather than when the JS wrappers are garbage collected.
                    target.texture.destroy();
                  }
                }
                // Android: Vulkan hands the buffer back to the encoder's GL
                // context through sync fences (sync_file descriptors), that
                // the encoder waits for on the GPU.
                const fences: bigint[] = [];
                if (IS_ANDROID) {
                  for (const { fence } of accessState.fences) {
                    const exported = fence.export();
                    if (exported.type === 'sync-fd') {
                      fences.push(exported.handle);
                    }
                  }
                }
                currentEncoder.endFrame!(currentTime, fences);
              } else {
                draw(currentSurface!.getCanvas());
                // The snapshot submits the frame's recording, then the frame
                // is read back to the CPU and handed to the encoder, which
                // copies it into its own video buffers.
                snapshot = currentSurface!.makeImageSnapshot(
                  undefined,
                  snapshot
                );
                const pixels = (
                  snapshot as unknown as { readPixels: ReadPixelsInto }
                ).readPixels(0, 0, frameInfo, framePixels!);
                if (!(pixels instanceof Uint8Array)) {
                  throw new Error('Failed to read the pixels of the frame');
                }
                currentEncoder.encodeFrame(pixels, currentTime);
              }
              afterDrawFrame?.(context);
              if (onProgress) {
                scheduleOnRN(onProgress, {
                  framesCompleted: i + 1,
                  nbFrames,
                });
              }
            });
          }
        } finally {
          // Also on cancellation or failure: the snapshot holds GPU memory
          // until the runtime collects it otherwise.
          snapshot?.dispose();
          if (targets.reused != null) {
            targets.reused.surface.dispose();
            targets.reused.texture.destroy();
            targets.reused = null;
          }
          // Note: the offscreen surface is deliberately not disposed — it is the
          // cached shared surface reused by the next export.
          frameExtractor?.dispose();
          releaseFrameImages(framesKey);
        }

        encoder!.finishWriting();
      } catch (e) {
        scheduleOnRN(settleReject, e);
        return;
      } finally {
        encoder?.dispose();
      }
      scheduleOnRN(settleResolve);
    })();
  });
