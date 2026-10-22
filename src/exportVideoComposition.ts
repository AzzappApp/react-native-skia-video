// GPUDevice, GPUTexture and the other GPU* types are the standard WebGPU
// types: @webgpu/types declares them as globals, as TypeScript's DOM library
// does for the browser, and React Native WebGPU's own types build on them.
// There is no module to import them from.
/// <reference types="@webgpu/types" />
import {
  createSynchronizable,
  createWorkletRuntime,
  runOnRuntime,
  scheduleOnRN,
  type WorkletRuntime,
} from 'react-native-worklets';
import { BlendMode, Skia } from 'react-native-skia';
import type { SkCanvas, SkSurface } from 'react-native-skia';
import { Platform } from 'react-native';
import {
  GPUTextureUsage,
  type GPUSharedTextureMemory,
  type RNCanvasContext,
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

const Promise = global.Promise;

const DEFAULT_AUDIO_BIT_RATE = 128000;
const DEFAULT_AUDIO_SAMPLE_RATE = 44100;
const DEFAULT_AUDIO_CHANNEL_COUNT = 2;

// Skia draws each frame directly into the encoder's input. iOS: into the
// frame buffer of the encoder, which hands out the same buffer for every
// frame: it is imported once. Android: into the encoder's input window,
// through a WebGPU canvas context (see makeWindowContext).
const IS_ANDROID = Platform.OS === 'android';

// iOS: an encoder's frame buffer imported into Skia's device.
type ExportTarget = {
  handle: bigint;
  memory: GPUSharedTextureMemory;
  texture: GPUTexture;
  surface: SkSurface;
  /** The canvas of the surface. */
  canvas: SkCanvas;
};

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

/**
 * Android: a canvas context presenting to the encoder's input window. Dawn's
 * swapchain hands each frame to the encoder once the GPU is done drawing it,
 * stamped with its presentation time by `encoder.beginFrame`: no copy, no
 * wait on the CPU.
 */
const makeWindowContext = (
  frameImageContext: ReturnType<typeof getFrameImageContext>,
  encoder: VideoEncoder,
  width: number,
  height: number
): RNCanvasContext => {
  'worklet';
  const { device, webgpu } = frameImageContext;
  const window = encoder.nativeWindow;
  if (window == null) {
    throw new Error('The encoder has no input window');
  }
  if (webgpu.MakeWebGPUCanvasContextFromNativeWindow == null) {
    throw new Error(
      '@azzapp/react-native-skia-video needs a React Native WebGPU with ' +
        'RNWebGPU.MakeWebGPUCanvasContextFromNativeWindow to export on Android'
    );
  }
  const context = webgpu.MakeWebGPUCanvasContextFromNativeWindow(
    window,
    width,
    height
  );
  context.configure({
    device,
    format: 'rgba8unorm',
    // As React Native Skia's own window surfaces: TextureBinding and CopySrc
    // for the drawings that read what is drawn.
    usage:
      GPUTextureUsage.RENDER_ATTACHMENT |
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_SRC,
    alphaMode: 'opaque',
  });
  return context;
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
      // iOS: the encoder's frame buffers, imported once (see IS_ANDROID).
      const targets: ExportTarget[] = [];
      // Android: presents to the encoder's input window, made with the first
      // frame (typed so: it is set in a callback).
      let windowContext = null as RNCanvasContext | null;
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

          frameExtractor =
            RNSkiaVideoModule.createVideoCompositionFramesExtractorSync(
              videoComposition
            );
          frameExtractor.start();

          const nbFrames = videoComposition.duration * options.frameRate;
          const clearColor = Skia.Color('#00000000');
          // Each frame runs inside a native autorelease pool (no-op on
          // Android). Worklets drains one pool per job it runs on a runtime
          // (software-mansion/react-native-reanimated#10192, from
          // react-native-worklets 0.10.4 and 0.11.4; never before), and this
          // whole export is a single job: the ObjC objects Skia and
          // AVFoundation autorelease with each frame would pile up until the
          // export ends.
          const runPooled =
            RNSkiaVideoModule.runWithAutoreleasePool ??
            ((fn: () => void) => fn());
          const currentExtractor = frameExtractor;
          for (let i = 0; i < nbFrames; i++) {
            if (cancelledSynchronizable.getDirty()) {
              return;
            }
            const currentTime = i / options.frameRate;
            runPooled(() => {
              const decodeStart = performance.now();
              const decodedFrames =
                currentExtractor.decodeCompositionFrames(currentTime);
              // How long the frame waited for the decoders, apart from
              // turning their frames into images: read by the benchmark of
              // the example app (private).
              (
                globalThis as unknown as { __rnskvExportDecodeWaitMs?: number }
              ).__rnskvExportDecodeWaitMs = performance.now() - decodeStart;
              const frames = makeVideoFrames(
                frameImageContext,
                framesKey,
                decodedFrames
              );
              const context = beforeDrawFrame?.() as any;
              if (IS_ANDROID) {
                windowContext ??= makeWindowContext(
                  frameImageContext,
                  currentEncoder,
                  options.width,
                  options.height
                );
                currentEncoder.beginFrame(currentTime);
                const targetSurface = Skia.Surface.MakeFromGPUTexture(
                  windowContext.getCurrentTexture()
                );
                const canvas = targetSurface.getCanvas();
                try {
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
                  // Submits the drawing: the present waits for it on the GPU.
                  targetSurface.flush();
                } finally {
                  // The swapchain's texture changes with each frame: released
                  // now, its canvas detached with it.
                  targetSurface.dispose();
                }
                windowContext.present();
                currentEncoder.endFrame(currentTime);
              } else {
                const handle = currentEncoder.beginFrame(currentTime)!;
                let target = targets.find(
                  (candidate) => candidate.handle === handle
                );
                if (target == null) {
                  const memory =
                    frameImageContext.device.importSharedTextureMemory({
                      handle,
                    });
                  let texture: GPUTexture | undefined;
                  try {
                    texture = memory.createTexture();
                    const targetSurface =
                      Skia.Surface.MakeFromGPUTexture(texture);
                    target = {
                      handle,
                      memory,
                      texture,
                      surface: targetSurface,
                      canvas: targetSurface.getCanvas(),
                    };
                  } catch (error) {
                    // Not in `targets` yet: released here rather than when
                    // the export runtime, idle once the export failed,
                    // collects it.
                    texture?.destroy();
                    memory.destroy();
                    throw error;
                  }
                  targets.push(target);
                }
                target.memory.beginAccess(target.texture, false);
                try {
                  target.canvas.drawColor(clearColor, BlendMode.Clear);
                  drawFrame({
                    context,
                    canvas: target.canvas,
                    videoComposition,
                    currentTime,
                    frames,
                    width: options.width,
                    height: options.height,
                  });
                  // The encoder reads the buffer as soon as it is handed
                  // back: wait for the GPU to finish drawing into it.
                  target.surface.flush(true);
                } finally {
                  // Releases the fences (MTLSharedEvent) of the access now
                  // rather than when collected.
                  for (const { fence } of target.memory.endAccess(
                    target.texture
                  ).fences) {
                    fence.destroy();
                  }
                }
                currentEncoder.endFrame(currentTime);
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
          // Also on cancellation or failure. Releases the swapchain and the
          // surface, with the buffers the encoder's window keeps until then,
          // before the encoder is released.
          windowContext?.unconfigure();
          for (const target of targets) {
            // Also detaches its canvas.
            target.surface.dispose();
            target.texture.destroy();
            target.memory.destroy();
          }
          targets.length = 0;
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
