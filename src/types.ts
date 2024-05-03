import type { SkCanvas } from '@shopify/react-native-skia';
import type { WorkletRuntime } from 'react-native-reanimated';

export type VideoFrame = {
  buffer: BigInt;
  width: number;
  height: number;
  rotation: number;
};

export type VideoDimensions = {
  width: number;
  height: number;
  rotation: number;
};

export type VideoPlayer = {
  play(): void;
  pause(): void;
  seekTo(time: number): void;
  readonly currentTime: number;
  readonly duration: number;
  readonly isPlaying: boolean;
  isLooping: boolean;
  volume: number;
  readonly rotation: number;
  decodeNextFrame(): VideoFrame;
  dispose(): void;
  on(
    name: 'ready',
    listener: (dimensions: VideoDimensions) => void
  ): () => void;
  on(name: 'bufferingStart', listener: () => void): () => void;
  on(name: 'bufferingEnd', listener: () => void): () => void;
  on(
    name: 'bufferingUpdate',
    listener: (loadedRanges: { start: number; duration: number }[]) => void
  ): () => void;
  on(name: 'complete', listener: () => void): () => void;
  on(
    name: 'playingStatusChange',
    listener: (isPlaying: boolean) => void
  ): () => void;
  on(name: 'error', listener: (error: any) => void): () => void;
};

export type VideoCompositionItem = {
  id: string;
  path: string;
  compositionStartTime: number;
  compositionEndTime: number;
};

export type VideoComposition = {
  items: VideoCompositionItem[];
  duration: number;
};

export type FrameDrawer = (args: {
  canvas: SkCanvas;
  videoComposition: VideoComposition;
  currentTime: number;
  frames: Record<string, VideoFrame>;
  width: number;
  height: number;
}) => void;

type VideoCompositionFramesExtractor = {
  play(): void;
  pause(): void;
  seekTo(time: number): void;
  decodeCompositionFrames(): Record<string, VideoFrame>;
  dispose(): void;
  readonly currentTime: number;
  readonly isPlaying: boolean;
  isLooping: boolean;
  on(name: 'ready', listener: () => void): () => void;
  on(name: 'complete', listener: () => void): () => void;
  on(name: 'error', listener: (error: any) => void): () => void;
};

export type ExportOptions = {
  outPath: string;
  width: number;
  height: number;
  frameRate: number;
  bitRate: number;
};

export type RNSkiaVideoModule = {
  createVideoPlayer: (uri: string) => VideoPlayer;
  createVideoCompositionFramesExtractor: (
    composition: VideoComposition
  ) => VideoCompositionFramesExtractor;
  exportVideoComposition: (
    videoComposition: VideoComposition,
    options: ExportOptions,
    workletRuntime: WorkletRuntime,
    // shareableRef: ShareableRef<FrameDrawer>,
    drawFrame: any,
    onCompletion: () => void,
    onError: (error: any) => void
  ) => Promise<void>;
};
