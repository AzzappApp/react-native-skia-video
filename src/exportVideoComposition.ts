import { runOnJS } from 'react-native-reanimated';
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
import { runOnNewThread } from './utils/thread';

const Promise = global.Promise;

const OS = Platform.OS;

/**
 * Exports a video composition to a video file.
 * @param videoComposition The video composition to export.
 * @param options The export options.
 * @param drawFrame The function used to draw the video frames.
 * @returns A promise that resolves when the export is complete.
 */
export const exportVideoComposition = async <T = undefined>({
  videoComposition,
  drawFrame,
  before,
  after,
  onProgress,
  ...options
}: {
  videoComposition: VideoComposition;
  drawFrame: FrameDrawer<T>;
  before?: () => T;
  after?: (context: T) => void;
  onProgress?: (progress: {
    framesCompleted: number;
    nbFrames: number;
  }) => void;
} & ExportOptions): Promise<void> =>
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
          const context = before?.() as any;
          drawFrame({
            context,
            canvas,
            videoComposition,
            currentTime,
            frames,
            width: options.width,
            height: options.height,
          });
          after?.(context);
          surface.flush();

          // On iOS and macOS, the first flush is not synchronous,
          // so we need to wait for the next frame
          if (i === 0 && (OS === 'ios' || OS === 'macos')) {
            RNSkiaVideoModule.usleep?.(1000);
          }
          const texture = surface.getNativeTextureUnstable();
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
