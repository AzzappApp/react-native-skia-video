import type { SkImage, SkSurface } from '@shopify/react-native-skia';
import { Skia } from '@shopify/react-native-skia';
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
   * Whether to keep calling `drawFrame` at every vsync while playback is
   * paused. By default a paused player only redraws when the composition time
   * or the decoded frames change (a seek, the frame that follows it), which
   * saves GPU time and battery. Enable it if `drawFrame` depends on values
   * that change while paused, an overlay being dragged for instance.
   * @default false
   */
  drawWhenPaused?: boolean;
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
export const useVideoCompositionPlayer = ({
  composition,
  drawFrame,
  beforeDrawFrame,
  afterDrawFrame,
  width,
  height,
  autoPlay = false,
  isLooping = false,
  drawWhenPaused = false,
  onReadyToPlay,
  onComplete,
  onError,
}: UseVideoCompositionPlayerOptions): UseVideoCompositionPlayerReturnType => {
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

  const currentFrame = useSharedValue<SkImage | null>(null);
  useEffect(
    () => () => {
      currentFrame.value = null;
      framesExtractor?.dispose();
    },
    [currentFrame, framesExtractor]
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

  const surfaceSharedValue = useSharedValue<SkSurface | null>(null);
  // Frames version and composition time of the last drawn image, to skip
  // redrawing an unchanged picture while paused.
  const lastDrawnFramesVersion = useSharedValue(-1);
  const lastDrawnTime = useSharedValue(-1);
  const pixelRatio = PixelRatio.get();
  useFrameCallback(() => {
    'worklet';
    if (!framesExtractor) {
      return;
    }

    // Pull the frames decoded since the last vsync first: it is cheap when
    // nothing new arrived, and it is what lets a paused player pick up the
    // frame of a seek.
    const frames = framesExtractor.decodeCompositionFrames();
    const currentTime = framesExtractor.currentTime;
    const framesVersion = framesExtractor.framesVersion;
    if (
      !drawWhenPaused &&
      !framesExtractor.isPlaying &&
      currentFrame.value !== null &&
      framesVersion === lastDrawnFramesVersion.value &&
      currentTime === lastDrawnTime.value
    ) {
      // Paused with nothing new: the image on screen is still exact, and
      // redrawing it at every vsync would only burn GPU time and battery.
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
    const context = beforeDrawFrame?.();
    drawFrame({
      canvas,
      context,
      videoComposition: composition!,
      currentTime,
      frames,
      width: width * pixelRatio,
      height: height * pixelRatio,
    });
    surface.flush();
    const previousFrame = currentFrame.value;
    try {
      // Recycle the previous SkImage (outputImage) to avoid allocating a new
      // JSI object on every frame.
      const nextFrame = Skia.Image.MakeImageFromNativeTextureUnstable(
        surface.getNativeTextureUnstable(),
        width * pixelRatio,
        height * pixelRatio,
        false,
        previousFrame ?? undefined
      );
      if (nextFrame === previousFrame) {
        // The recycled image keeps the same identity, so listeners (the Skia
        // canvas) must be forced to re-run.
        currentFrame.modify(undefined, true);
      } else {
        currentFrame.value = nextFrame;
      }
    } catch (error) {
      console.warn('Failed to create image from texture', error);
      return;
    }
    lastDrawnFramesVersion.value = framesVersion;
    lastDrawnTime.value = currentTime;
    afterDrawFrame?.(context);
  }, true);

  return {
    currentFrame,
    player: framesExtractor,
  };
};
