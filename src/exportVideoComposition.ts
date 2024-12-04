import {
  createWorkletRuntime,
  runOnRuntime,
  runOnJS,
} from 'react-native-reanimated';
import { Platform } from 'react-native';
import { Skia } from '@shopify/react-native-skia';
import type { SkSurface } from '@shopify/react-native-skia';
import type {
  ExportOptions,
  FrameDrawer,
  VideoComposition,
  VideoEncoder,
  VideoCompositionFramesExtractorSync,
} from './types';
import RNSkiaVideoModule from './RNSkiaVideoModule';

const runOnNewThread = (fn: () => void) => {
  const exportRuntime = createWorkletRuntime(
    'RNSkiaVideoExportRuntime-' + performance.now()
  );
  const isAndroid = Platform.OS === 'android';
  runOnRuntime(exportRuntime, () => {
    'worklet';
    if (isAndroid) {
      (RNSkiaVideoModule as any).runWithJNIClassLoader(fn);
    } else {
      fn();
    }
  })();
};

/**
 * Exports a video composition to a video file.
 * @param videoComposition The video composition to export.
 * @param options The export options.
 * @param drawFrame The function used to draw the video frames.
 * @returns A promise that resolves when the export is complete.
 */
export const exportVideoComposition = async (
  videoComposition: VideoComposition,
  options: ExportOptions,
  drawFrame: FrameDrawer,
  onProgress?: (progress: { framesCompleted: number; nbFrames: number }) => void
): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    runOnNewThread(() => {
      'worklet';

      let surface: SkSurface | null = null;
      let frameExtractor: VideoCompositionFramesExtractorSync | null = null;
      let encoder: VideoEncoder | null = null;
      const { width, height } = options;
      try {
        surface = Skia.Surface.MakeOffscreen(width, height);
        if (!surface) {
          throw new Error('Failed to create Skia surface');
        }

        encoder = RNSkiaVideoModule.createVideoEncoder(options);
        encoder.prepare();

        frameExtractor =
          RNSkiaVideoModule.createVideoCompositionFramesExtractorSync(
            videoComposition
          );
        frameExtractor.start();

        const nbFrames = videoComposition.duration * options.frameRate;
        for (let i = 0; i < nbFrames; i++) {
          const currentTime = i / options.frameRate;
          const frames = frameExtractor.decodeCompositionFrames(currentTime);
          const canvas = surface.getCanvas();
          canvas.clear(Skia.Color('#00000000'));
          drawFrame({
            canvas,
            videoComposition,
            currentTime,
            frames,
            width: options.width,
            height: options.height,
          });
          surface.flush();
          const texture = surface.getBackendTexture();
          encoder.encodeFrame(texture, currentTime);
          if (onProgress) {
            runOnJS(onProgress)({
              framesCompleted: i + 1,
              nbFrames,
            });
          }
        }
      } catch (e) {
        runOnJS(reject)(e);
        return;
      } finally {
        frameExtractor?.dispose();
        surface?.dispose();
      }

      try {
        encoder!.finishWriting();
      } catch (e) {
        runOnJS(reject)(e);
        return;
      } finally {
        encoder?.dispose();
      }
      runOnJS(resolve)();
    });
  });
