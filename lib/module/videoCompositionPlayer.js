"use strict";

import { BlendMode, Skia } from '@shopify/react-native-skia';
import { useSharedValue, useFrameCallback, runOnUI } from 'react-native-reanimated';
import { useCallback, useEffect, useMemo, useState } from 'react';
import RNSkiaVideoModule from "./RNSkiaVideoModule.js";
import useEventListener from "./utils/useEventListener.js";
import { PixelRatio } from 'react-native';
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
  onError
}) => {
  const [isErrored, setIsErrored] = useState(false);
  const framesExtractor = useMemo(() => {
    if (composition && !isErrored) {
      return RNSkiaVideoModule.createVideoCompositionFramesExtractor(composition);
    }
    return null;
  }, [isErrored, composition]);
  useEffect(() => {
    runOnUI(() => {
      if (!framesExtractor) {
        return;
      }
      // On Android prepare() shares the GL context current on this thread,
      // Skia's, which Skia only makes on its first drawing: a player that is
      // the app's first Skia content found none and threw, killing the app.
      // A throwaway surface makes it, as the export's surface does before the
      // encoder shares it.
      Skia.Surface.MakeOffscreen(1, 1)?.dispose();
      framesExtractor.prepare();
    })();
  }, [framesExtractor]);
  const currentFrame = useSharedValue(null);
  useEffect(() => () => {
    currentFrame.value = null;
    framesExtractor?.dispose();
  }, [currentFrame, framesExtractor]);
  const retry = useCallback(() => {
    setIsErrored(false);
  }, []);
  const errorHandler = useCallback(error => {
    onError?.(error, retry);
    setIsErrored(true);
  }, [onError, retry]);
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
  const surfaceSharedValue = useSharedValue(null);
  const surfaceWidth = useSharedValue(0);
  const surfaceHeight = useSharedValue(0);
  // Frames version and composition time of the last drawn image, to skip
  // redrawing an unchanged picture while paused.
  const lastDrawnFramesVersion = useSharedValue(-1);
  const lastDrawnTime = useSharedValue(-1);
  const pixelRatio = PixelRatio.get();

  // Release the offscreen surface with the hook that made it. Without this a
  // caller that mounts and unmounts the player repeatedly — a player inside a
  // modal, say — leaks a full size texture per cycle. runOnUI because this
  // effect is declared before the frame callback below, and so its cleanup runs
  // before the callback is unregistered.
  useEffect(() => () => {
    runOnUI(() => {
      surfaceSharedValue.value?.dispose();
      surfaceSharedValue.value = null;
      surfaceWidth.value = 0;
      surfaceHeight.value = 0;
    })();
  }, [surfaceSharedValue, surfaceWidth, surfaceHeight]);
  useFrameCallback(() => {
    'worklet';

    if (!framesExtractor) {
      return;
    }
    const pixelWidth = Math.floor(width * pixelRatio);
    const pixelHeight = Math.floor(height * pixelRatio);

    // A player inside a view that has not been laid out yet is called with a
    // zero — or NaN — size. MakeOffscreen accepts it and hands back a surface
    // whose texture is null, which aborts the process inside
    // MakeImageFromNativeTextureUnstable rather than throwing. Waiting for a
    // real size costs one frame and cannot crash.
    if (!(pixelWidth > 0) || !(pixelHeight > 0) || !isFinite(pixelWidth) || !isFinite(pixelHeight)) {
      return;
    }

    // Pull the frames decoded since the last vsync first: it is cheap when
    // nothing new arrived, and it is what lets a paused player pick up the
    // frame of a seek.
    const frames = framesExtractor.decodeCompositionFrames();
    const currentTime = framesExtractor.currentTime;
    const framesVersion = framesExtractor.framesVersion;
    if (!drawWhenPaused && !framesExtractor.isPlaying && currentFrame.value !== null && framesVersion === lastDrawnFramesVersion.value && currentTime === lastDrawnTime.value) {
      // Paused with nothing new: the image on screen is still exact, and
      // redrawing it at every vsync would only burn GPU time and battery.
      return;
    }
    let surface = surfaceSharedValue.value;
    if (!surface || surfaceWidth.value !== pixelWidth || surfaceHeight.value !== pixelHeight) {
      // width and height can change while the player stays mounted — laying the
      // stage out for a different aspect ratio calls the hook with new
      // dimensions and the same surface. Drawing the new size into the old
      // texture and then declaring the result to be the new size stretches the
      // picture by the ratio between them, so the surface is re-keyed on its
      // dimensions the way exportVideoComposition already re-keys its own.
      surface?.dispose();
      surface = Skia.Surface.MakeOffscreen(pixelWidth, pixelHeight);
      surfaceSharedValue.value = surface;
      surfaceWidth.value = pixelWidth;
      surfaceHeight.value = pixelHeight;
      // The recycled wrapper below is bound to the texture that just went away.
      currentFrame.value = null;
    }
    if (!surface) {
      console.warn('Failed to create surface');
      return;
    }
    const canvas = surface.getCanvas();
    // Cleared as the export clears it: a drawFrame that leaves part of the
    // canvas alone showed the previous frames there, and not in the export.
    canvas.drawColor(Skia.Color('#00000000'), BlendMode.Clear);
    const context = beforeDrawFrame?.();
    drawFrame({
      canvas,
      context,
      videoComposition: composition,
      currentTime,
      frames,
      width: pixelWidth,
      height: pixelHeight
    });
    surface.flush();

    // Checked rather than passed straight through: the texture is read by
    // native code that asserts on its type, so a null one aborts the process
    // instead of raising something the catch below could take.
    const texture = surface.getNativeTextureUnstable();
    if (!texture) {
      console.warn('Surface has no native texture');
      return;
    }
    const previousFrame = currentFrame.value;
    try {
      // Recycle the previous SkImage (outputImage) to avoid allocating a new
      // JSI object on every frame.
      const nextFrame = Skia.Image.MakeImageFromNativeTextureUnstable(texture, pixelWidth, pixelHeight, false, previousFrame ?? undefined);
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
    player: framesExtractor
  };
};
//# sourceMappingURL=videoCompositionPlayer.js.map