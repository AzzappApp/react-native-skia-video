import { useSharedValue, useFrameCallback } from 'react-native-reanimated';
import { useCallback, useEffect, useMemo, useState } from 'react';
import useEventListener from './utils/useEventListener';
import type { BufferingRange, VideoDimensions, VideoFrame } from './types';
import RNSkiaVideoModule from './RNSkiaVideoModule';

export type UseVideoPlayerOptions = {
  uri: string | null;
  autoPlay?: boolean;
  isLooping?: boolean;
  volume?: number;
  onReadyToPlay?: (dimensions: VideoDimensions) => void;
  onBufferingStart?: () => void;
  onBufferingEnd?: () => void;
  onBufferingUpdate?: (loadedRanges: BufferingRange[]) => void;
  onComplete?: () => void;
  onError?: (error: any, retry: () => void) => void;
  onPlayingStatusChange?: (playing: boolean) => void;
  onSeekComplete?: () => void;
};

export const useVideoPlayer = ({
  uri,
  autoPlay = true,
  isLooping = false,
  volume = 1,
  onReadyToPlay,
  onBufferingStart,
  onBufferingEnd,
  onBufferingUpdate,
  onComplete,
  onError,
  onPlayingStatusChange,
  onSeekComplete,
}: UseVideoPlayerOptions) => {
  const [isErrored, setIsErrored] = useState(false);
  const player = useMemo(() => {
    if (uri && !isErrored) {
      return RNSkiaVideoModule.createVideoPlayer(uri);
    }
    return null;
  }, [isErrored, uri]);

  const currentFrame = useSharedValue<null | VideoFrame>(null);
  useEffect(
    () => () => {
      currentFrame.value = null;
      player?.dispose();
    },
    [player, currentFrame]
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
    if (player) {
      player.isLooping = isLooping;
    }
  }, [player, isLooping]);

  useEffect(() => {
    if (player) {
      player.volume = volume;
    }
  }, [player, volume]);

  useEventListener(player, 'ready', onReadyToPlay);
  useEventListener(player, 'bufferingStart', onBufferingStart);
  useEventListener(player, 'bufferingEnd', onBufferingEnd);
  useEventListener(player, 'bufferingUpdate', onBufferingUpdate);
  useEventListener(player, 'complete', onComplete);
  useEventListener(player, 'error', errorHandler);
  useEventListener(player, 'playingStatusChange', onPlayingStatusChange);
  useEventListener(player, 'seekComplete', onSeekComplete);

  useEffect(() => {
    if (autoPlay) {
      player?.play();
    }
  }, [player, autoPlay]);

  const frameCallback = useFrameCallback(() => {
    if (!player || (!player.isPlaying && currentFrame.value)) {
      return;
    }
    let nextFrame = player.decodeNextFrame();
    if (nextFrame) {
      currentFrame.value = nextFrame;
    }
  });

  useEffect(() => {
    frameCallback.setActive(!!player);
    return () => frameCallback.setActive(false);
  }, [frameCallback, player]);

  return {
    currentFrame,
    player,
  };
};
