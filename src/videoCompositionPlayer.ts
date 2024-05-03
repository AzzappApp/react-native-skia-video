import { createPicture } from '@shopify/react-native-skia';
import type { SkPicture } from '@shopify/react-native-skia';
import { useSharedValue, useFrameCallback } from 'react-native-reanimated';
import { useEffect, useMemo } from 'react';
import type { FrameDrawer, VideoComposition } from './types';
import RNSkiaVideoModule from './RNSkiaVideoModule';
import useEventListener from './utils/useEventListener';

type UseVideoCompositionPlayerOptions = {
  composition: VideoComposition | null;
  drawFrame: FrameDrawer;
  width: number;
  height: number;
  autoPlay?: boolean;
  isLooping?: boolean;
  onReadyToPlay?: () => void;
  onComplete?: () => void;
  onError?: (error: any) => void;
};

export const useVideoCompositionPlayer = ({
  composition,
  drawFrame,
  width,
  height,
  autoPlay = true,
  isLooping = true,
  onReadyToPlay,
  onComplete,
  onError,
}: UseVideoCompositionPlayerOptions) => {
  const framesExtractor = useMemo(() => {
    if (composition) {
      return RNSkiaVideoModule.createVideoCompositionFramesExtractor(
        composition
      );
    }
    return null;
  }, [composition]);
  const currentFrame = useSharedValue<SkPicture>(createPicture(() => {}));

  useEffect(() => {
    if (framesExtractor) {
      framesExtractor.isLooping = isLooping;
    }
  }, [framesExtractor, isLooping]);

  useEffect(() => {
    if (autoPlay) {
      framesExtractor?.play();
    }
  }, [framesExtractor, autoPlay]);

  useEventListener(framesExtractor, 'ready', onReadyToPlay);
  useEventListener(framesExtractor, 'complete', onComplete);
  useEventListener(framesExtractor, 'error', onError);

  useFrameCallback(() => {
    'worklet';
    if (!framesExtractor) {
      currentFrame.value?.dispose();
      currentFrame.value = createPicture(() => {});
      return;
    }
    if (!framesExtractor.isPlaying) {
      return;
    }

    currentFrame.value?.dispose();
    currentFrame.value = createPicture(
      (canvas) => {
        drawFrame({
          canvas,
          videoComposition: composition!,
          currentTime: framesExtractor.currentTime / 1000,
          frames: framesExtractor.decodeCompositionFrames(),
          width: width,
          height: height,
        });
      },
      { width, height }
    );
  }, true);

  useEffect(
    () => () => {
      currentFrame.value?.dispose();
    },
    [currentFrame]
  );

  return useMemo(
    () => ({
      currentFrame,
      player: framesExtractor && {
        play: () => framesExtractor.play(),
        pause: () => framesExtractor.pause(),
        seekTo: (time: number) => framesExtractor.seekTo(time * 1000),
        get currentTime() {
          return framesExtractor.currentTime;
        },
        get isPlaying() {
          return framesExtractor.isPlaying;
        },
      },
    }),
    [currentFrame, framesExtractor]
  );
};
