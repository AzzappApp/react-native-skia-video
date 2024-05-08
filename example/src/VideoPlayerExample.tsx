import { useCallback, useEffect, useMemo, useState } from 'react';
import { Blur, Canvas, Image, Rect, Skia } from '@shopify/react-native-skia';
import {
  ActivityIndicator,
  Button,
  View,
  useWindowDimensions,
} from 'react-native';
import {
  useVideoPlayer,
  type BufferingRange,
} from '@azzapp/react-native-skia-video';
import Slider from '@react-native-community/slider';
import Animated, {
  useDerivedValue,
  useFrameCallback,
  useSharedValue,
} from 'react-native-reanimated';
import type { Video } from 'pexels';
import pexelsClient from './helpers/pexelsClient';

const VideoPlayerExample = () => {
  const [video, setVideo] = useState<Video | null>(null);
  const [loadedRanges, setLoadedRanges] = useState<BufferingRange[]>([]);
  const [loading, setLoading] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [blur, setBlur] = useState(false);

  const loadRandomVideo = useCallback(() => {
    setLoading(true);
    setVideo(null);
    setLoadedRanges([]);
    pexelsClient.videos
      .popular({ per_page: 1, page: Math.round(Math.random() * 1000) })
      .then(
        (response) => {
          if ('error' in response) {
            console.error('Pexels API request failed, try again.');
            return;
          }
          setVideo(response.videos[0] ?? null);
        },
        () => {
          console.error('Pexels API request failed, try again.');
        }
      );
  }, []);

  useEffect(() => {
    loadRandomVideo();
  }, [loadRandomVideo]);

  const onReadyToPlay = useCallback(() => {
    setLoading(false);
  }, []);

  const onPlayingStatusChange = useCallback((isPlaying: boolean) => {
    setIsPlaying(isPlaying);
  }, []);

  const onBufferingUpdate = useCallback((loadedRanges: BufferingRange[]) => {
    setLoadedRanges(loadedRanges);
  }, []);

  const { currentFrame, player } = useVideoPlayer({
    uri: video?.video_files.find((file) => file.quality === 'hd')?.link ?? null,
    autoPlay: false,
    isLooping: true,
    onReadyToPlay,
    onPlayingStatusChange,
    onBufferingUpdate,
  });

  const videoImage = useDerivedValue(() => {
    const frame = currentFrame.value;
    if (!frame) {
      return null;
    }
    return Skia.Image.MakeImageFromNativeBuffer(frame.buffer);
  });

  const currentTime = useSharedValue(0);
  useFrameCallback(() => {
    currentTime.value = player?.currentTime ?? 0;
  }, true);

  const { width: windowWidth } = useWindowDimensions();
  const aspectRatio = video ? video.width / video.height : 16 / 9;
  const videoDimensions = useMemo(
    () =>
      aspectRatio >= 1
        ? {
            width: windowWidth,
            height: windowWidth / aspectRatio,
          }
        : {
            width: windowWidth * aspectRatio,
            height: windowWidth,
          },
    [aspectRatio, windowWidth]
  );

  const canvasDimensions = useMemo(
    () => ({
      width: windowWidth,
      height: videoDimensions.height,
    }),
    [windowWidth, videoDimensions.height]
  );

  // on android reconciliation of Image component might fails, so we need to avoid rerendering
  // for things like play/pause button change
  const canvas = useMemo(
    () => (
      <Canvas style={canvasDimensions}>
        <Rect
          x={0}
          y={0}
          width={canvasDimensions.width}
          height={canvasDimensions.height}
          color="black"
        />
        <Image
          x={canvasDimensions.width / 2 - videoDimensions.width / 2}
          y={0}
          width={videoDimensions.width}
          height={videoDimensions.height}
          image={videoImage}
        >
          <Blur blur={blur ? 5 : 0} />
        </Image>
      </Canvas>
    ),
    [videoImage, canvasDimensions, videoDimensions, blur]
  );

  return (
    <View style={{ flex: 1 }}>
      {canvas}
      {video &&
        loadedRanges.map((range, index) => (
          <View
            key={index}
            style={{
              position: 'absolute',
              top: canvasDimensions.height,
              left: (range.start / video.duration) * windowWidth,
              width: (range.duration / video.duration) * windowWidth,
              height: 5,
              backgroundColor: 'rgba(255, 0, 0, 0.5)',
            }}
          />
        ))}
      {loading && (
        <ActivityIndicator
          size="large"
          color="white"
          style={{
            position: 'absolute',
            top: canvasDimensions.height / 2 - 18,
            left: canvasDimensions.width / 2 - 18,
          }}
        />
      )}
      <View style={{ marginTop: 10, flex: 1, gap: 20, alignItems: 'center' }}>
        <AnimatedSlider
          value={currentTime}
          minimumValue={0}
          maximumValue={video?.duration ?? 0}
          onValueChange={(value) => {
            player?.seekTo(value);
          }}
          style={{ alignSelf: 'stretch' }}
          disabled={loading}
          maximumTrackTintColor={'#CCC'}
          minimumTrackTintColor={'#F00'}
        />

        <Button
          title={isPlaying ? 'Pause' : 'Play'}
          onPress={() => (isPlaying ? player?.pause() : player?.play())}
          disabled={loading}
        />
        <Button
          title={'Load Random Video'}
          onPress={loadRandomVideo}
          disabled={loading}
        />
        <Button
          title={blur ? 'Unblur' : 'Blur'}
          onPress={() => setBlur((blur) => !blur)}
        />
      </View>
    </View>
  );
};

export default VideoPlayerExample;

const AnimatedSlider = Animated.createAnimatedComponent(Slider);
