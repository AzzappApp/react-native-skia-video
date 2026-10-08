import type { SkImage, SkSurface } from 'react-native-skia';
import { Skia } from 'react-native-skia';
import {
  useSharedValue,
  useFrameCallback,
  runOnUI,
  type DerivedValue,
} from 'react-native-reanimated';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  FrameDrawer,
  VideoComposition,
  VideoCompositionFramesExtractor,
} from './types';
import RNSkiaVideoModule from './RNSkiaVideoModule';
import {
  createFrameImagesKey,
  getFrameImageContext,
  makeVideoFrames,
  releaseFrameImages,
} from './frameImages';
import useEventListener from './utils/useEventListener';
import { PixelRatio } from 'react-native';

type UseVideoCompositionPlayerOptions<T = undefined> = {
  /**
   * The video composition to play.
   * if null, the composition player won't be created.
   */
  composition: VideoComposition | null;
  /**
   * The function used to draw the composition frames.
   */
  drawFrame: FrameDrawer<T>;
  /**
   * A function that is called before drawing each frame.
   * the return value will be passed to the drawFrame function as context.
   */
  beforeDrawFrame?: () => T;
  /**
   * A function that is called after drawing each frame.
   * the context returned by the beforeDrawFrame function will be passed to this function.
   * This function can be used to clean up resources allocated during the drawFrame function.
   */
  afterDrawFrame?: (context: T) => void;
  /**
   * The width of rendered frames.
   */
  width: number;
  /**
   * The height of rendered frames.
   */
  height: number;
  /**
   * Whether the composition should start playing automatically.
   */
  autoPlay?: boolean;
  /**
   * Weather the composition should loop.
   */
  isLooping?: boolean;
  /**
   * Callback that is called when the composition is ready to play.
   */
  onReadyToPlay?: () => void;
  /**
   * Callback that is called when the composition playback completes.
   */
  onComplete?: () => void;
  /**
   * Callback that is called when an error occurs.
   * @param error the error that occurred.
   * @param retry a function that can be called to retry the operation.
   */
  onError?: (error: any, retry: () => void) => void;
};

type VideoCompositionPlayerController = Pick<
  VideoCompositionFramesExtractor,
  'currentTime' | 'play' | 'pause' | 'seekTo' | 'isPlaying'
>;

type UseVideoCompositionPlayerReturnType = {
  /**
   * The current drawn frame of the video composition.
   */
  currentFrame: DerivedValue<SkImage | null>;
  /**
   * The video player controller.
   */
  player: VideoCompositionPlayerController | null;
};

/**
 * A hook that creates a video composition player.
 */
export const useVideoCompositionPlayer = <T = undefined>({
  composition,
  drawFrame,
  beforeDrawFrame,
  afterDrawFrame,
  width,
  height,
  autoPlay = false,
  isLooping = false,
  onReadyToPlay,
  onComplete,
  onError,
}: UseVideoCompositionPlayerOptions<T>): UseVideoCompositionPlayerReturnType => {
  const [isErrored, setIsErrored] = useState(false);
  const framesExtractor = useMemo(() => {
    if (composition && !isErrored) {
      return RNSkiaVideoModule.createVideoCompositionFramesExtractor(
        composition
      );
    }
    return null;
  }, [isErrored, composition]);

  useEffect(() => {
    runOnUI(() => {
      framesExtractor?.prepare();
    })();
  }, [framesExtractor]);

  const frameImageContext = useMemo(() => getFrameImageContext(), []);
  const framesKey = useMemo(() => createFrameImagesKey(), []);

  // The offscreen surface the frames are drawn into. `currentFrame` is its
  // image (surface.asImage()): the same image for every frame, sharing the
  // texture of the surface.
  const surfaceSharedValue = useSharedValue<SkSurface | null>(null);
  const currentFrame = useSharedValue<SkImage | null>(null);
  useEffect(
    () => () => {
      framesExtractor?.dispose();
      runOnUI(() => {
        'worklet';
        releaseFrameImages(framesKey);
        // Released now rather than when the UI runtime collects them: a
        // collected surface is only destroyed once the UI thread creates
        // another Skia surface or image.
        const frame = currentFrame.value;
        currentFrame.value = null;
        frame?.dispose();
        const surface = surfaceSharedValue.value;
        surfaceSharedValue.value = null;
        surface?.dispose();
      })();
    },
    [currentFrame, framesExtractor, framesKey, surfaceSharedValue]
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

  const pixelRatio = PixelRatio.get();
  useFrameCallback(() => {
    'worklet';
    if (!framesExtractor) {
      return;
    }

    let surface: SkSurface | null = surfaceSharedValue.value;

    if (!surface) {
      surface = Skia.Surface.MakeOffscreen(
        width * pixelRatio,
        height * pixelRatio
      );
      surfaceSharedValue.value = surface;
    }
    if (!surface) {
      console.warn('Failed to create surface');
      return;
    }

    const canvas = surface.getCanvas();
    const context = beforeDrawFrame?.() as T;
    drawFrame({
      canvas,
      context,
      videoComposition: composition!,
      currentTime: framesExtractor.currentTime,
      frames: makeVideoFrames(
        frameImageContext,
        framesKey,
        framesExtractor.decodeCompositionFrames()
      ),
      width: width * pixelRatio,
      height: height * pixelRatio,
    });
    try {
      // Submits the frame's recording: the image shares the texture of the
      // surface (no copy), so a canvas drawing it shows this frame once the
      // drawing reaches the GPU.
      surface.flush();
      if (currentFrame.value == null) {
        currentFrame.value = surface.asImage();
      } else {
        // The image keeps the same identity from frame to frame, so the
        // listeners (the Skia canvas) must be forced to re-run.
        currentFrame.modify(undefined, true);
      }
    } catch (error) {
      console.warn('Failed to flush the composition frame', error);
      return;
    }
    afterDrawFrame?.(context);
  }, true);

  return {
    currentFrame,
    player: framesExtractor,
  };
};
