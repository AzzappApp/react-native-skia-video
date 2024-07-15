import {
  createWorkletRuntime,
  makeShareableCloneRecursive,
  type WorkletRuntime,
} from 'react-native-reanimated';
import { Platform } from 'react-native';
import { Skia } from '@shopify/react-native-skia';
import type { SkCanvas, SkSurface } from '@shopify/react-native-skia';
import type {
  ExportOptions,
  FrameDrawer,
  VideoComposition,
  VideoFrame,
} from './types';
import RNSkiaVideoModule from './RNSkiaVideoModule';

let exportRuntime: WorkletRuntime;
const getExportRuntime = () => {
  if (!exportRuntime) {
    exportRuntime = createWorkletRuntime('RNSkiaVideoExportRuntime');
  }
  return exportRuntime;
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
): Promise<void> => {
  let surface: SkSurface | null = null;
  let drawFrameInner: (...args: any[]) => void;
  if (Platform.OS === 'android') {
    surface = Skia.Surface.Make(1, 1);
    if (!surface) {
      throw new Error('Failed to create Skia surface');
    }
    drawFrameInner = (time: number, frames: Record<string, VideoFrame>) => {
      'worklet';
      drawFrame({
        canvas: surface!.getCanvas(),
        videoComposition,
        currentTime: time,
        frames,
        width: options.width,
        height: options.height,
      });
    };
  } else {
    drawFrameInner = (
      canvas: SkCanvas,
      time: number,
      frames: Record<string, VideoFrame>
    ) => {
      'worklet';
      drawFrame({
        canvas,
        videoComposition,
        currentTime: time,
        frames,
        width: options.width,
        height: options.height,
      });
    };
  }

  const nbFrames = videoComposition.duration * options.frameRate;

  return new Promise((resolve, reject) =>
    RNSkiaVideoModule.exportVideoComposition(
      videoComposition,
      options,
      getExportRuntime(),
      makeShareableCloneRecursive(drawFrameInner),
      () => resolve(),
      (e: any) => reject(e ?? new Error('Failed to export video')),
      onProgress
        ? (frameIndex) =>
            onProgress({
              framesCompleted: frameIndex + 1,
              nbFrames,
            })
        : null,
      surface
    )
  );
};
