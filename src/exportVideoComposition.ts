import {
  createWorkletRuntime,
  makeShareableCloneRecursive,
  type WorkletRuntime,
} from 'react-native-reanimated';
import type { SkCanvas } from '@shopify/react-native-skia';
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

export const exportVideoComposition = async (
  videoComposition: VideoComposition,
  options: ExportOptions,
  drawFrame: FrameDrawer
): Promise<void> => {
  const drawFrameInner = (
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

  return new Promise((resolve, reject) =>
    RNSkiaVideoModule.exportVideoComposition(
      videoComposition,
      options,
      getExportRuntime(),
      makeShareableCloneRecursive(drawFrameInner),
      () => resolve(),
      (e: any) => reject(e ?? new Error('Failed to export video'))
    )
  );
};
