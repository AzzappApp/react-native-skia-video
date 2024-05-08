import { createPicture } from '@shopify/react-native-skia';
import type { SkPicture } from '@shopify/react-native-skia';
import {
  useSharedValue,
  useDerivedValue,
  useFrameCallback,
} from 'react-native-reanimated';
import { useCallback, useEffect, useMemo, useState } from 'react';
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
  onError?: (error: any, retry: () => void) => void;
};

export const useVideoCompositionPlayer = ({
  composition,
  drawFrame,
  width,
  height,
  autoPlay = false,
  isLooping = false,
  onReadyToPlay,
  onComplete,
  onError,
}: UseVideoCompositionPlayerOptions) => {
  const [isErrored, setIsErrored] = useState(false);
  const framesExtractor = useMemo(() => {
    if (composition && !isErrored) {
      return RNSkiaVideoModule.createVideoCompositionFramesExtractor(
        composition
      );
    }
    return null;
  }, [isErrored, composition]);

  const currentFrame = useSharedValue<SkPicture | null>(null);
  useEffect(
    () => () => {
      currentFrame.value = null;
      framesExtractor?.dispose();
    },
    [framesExtractor, currentFrame]
  );

  const retry = useCallback(() => {
    setIsErrored(false);
  }, []);

  const errorHandler = useCallback(
    (error: any) => {
      onError?.(error, retry);
      setIsErrored(true);
    },
    [onError, retry]
  );

  useEffect(() => {
    if (framesExtractor) {
      framesExtractor.isLooping = isLooping;
    }
  }, [framesExtractor, isLooping]);

  useEventListener(framesExtractor, 'ready', onReadyToPlay);
  useEventListener(framesExtractor, 'complete', onComplete);
  useEventListener(framesExtractor, 'error', errorHandler);

  useEffect(() => {
    if (autoPlay) {
      framesExtractor?.play();
    }
  }, [framesExtractor, autoPlay]);

  useFrameCallback(() => {
    'worklet';
    if (
      !framesExtractor ||
      (!framesExtractor.isPlaying && currentFrame.value)
    ) {
      return;
    }

    currentFrame.value?.dispose();
    currentFrame.value = createPicture(
      (canvas) => {
        drawFrame({
          canvas,
          videoComposition: composition!,
          currentTime: framesExtractor.currentTime,
          frames: framesExtractor.decodeCompositionFrames(),
          width: width,
          height: height,
        });
      },
      { width, height }
    );
  }, true);

  return {
    currentFrame: useDerivedValue(
      () => currentFrame.value ?? createPicture(() => {})
    ),
    player: framesExtractor,
  };
};
