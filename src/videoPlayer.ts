import {
  useSharedValue,
  useFrameCallback,
  type SharedValue,
} from 'react-native-reanimated';
import { useCallback, useEffect, useMemo, useState } from 'react';
import useEventListener from './utils/useEventListener';
import type {
  BufferingRange,
  VideoDimensions,
  VideoFrame,
  VideoPlayer,
} from './types';
import RNSkiaVideoModule from './RNSkiaVideoModule';

type UseVideoPlayerOptions = {
  /**
   * The URI of the video to play.
   * if null, the video player won't be created.
   */
  uri: string | null;
  /**
   * If provided, the resolution to scale the video to.
   * If not provided, the original resolution of the video will be used.
   * Downscaling the video can improve performance.
   * Changing the resolution after the video player will lead to re-creating the video player.
   */
  resolution?: { width: number; height: number } | null;
  /**
   * Whether the video should start playing automatically.
   */
  autoPlay?: boolean;
  /**
   * Weather the video should loop.
   */
  isLooping?: boolean;
  /**
   * The volume of the video.
   */
  volume?: number;
  /**
   * Callback that is called when the video is ready to play.
   * @param dimensions The dimensions of the video.
   */
  onReadyToPlay?: (dimensions: VideoDimensions) => void;
  /**
   * Callback that is called when the video starts buffering.
   */
  onBufferingStart?: () => void;
  /**
   * Callback that is called when the video stops buffering.
   */
  onBufferingEnd?: () => void;
  /**
   * Callback that is called when the buffered ranges are updated.
   * @param loadedRanges The buffered ranges.
   */
  onBufferingUpdate?: (loadedRanges: BufferingRange[]) => void;
  /**
   * Callback that is called when the video playback completes.
   */
  onComplete?: () => void;
  /**
   * Callback that is called when an error occurs.
   * @param error the error that occurred.
   * @param retry a function that can be called to retry the operation.
   */
  onError?: (error: any, retry: () => void) => void;
  /**
   * Callback that is called when the playing status changes.
   * @param playing Whether the video is playing.
   */
  onPlayingStatusChange?: (playing: boolean) => void;
  /**
   * Callback that is called when a seek operation completes.
   * @returns
   */
  onSeekComplete?: () => void;
};

type VideoPlayerController = Pick<
  VideoPlayer,
  'currentTime' | 'duration' | 'play' | 'pause' | 'seekTo' | 'isPlaying'
>;

type UseVideoPlayerReturnType = {
  /**
   * The current frame of the playing video.
   */
  currentFrame: SharedValue<VideoFrame | null>;
  /**
   * The video player controller.
   */
  player: VideoPlayerController | null;
};

/**
 * Hook that creates a video player and manages its state.
 * @param options The options for the video player.
 * @returns
 */
export const useVideoPlayer = ({
  uri,
  resolution,
  autoPlay = false,
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
}: UseVideoPlayerOptions): UseVideoPlayerReturnType => {
  const [isErrored, setIsErrored] = useState(false);
  const player = useMemo(() => {
    if (uri && !isErrored) {
      return RNSkiaVideoModule.createVideoPlayer(uri, resolution);
    }
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isErrored, resolution?.width, resolution?.height, uri]);

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

  useFrameCallback(() => {
    if (!player || (!player.isPlaying && currentFrame.value)) {
      return;
    }
    let nextFrame = player.decodeNextFrame();
    if (nextFrame) {
      currentFrame.value = nextFrame;
    }
  }, true);

  return {
    currentFrame,
    player,
  };
};
