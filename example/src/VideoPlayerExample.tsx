import { useCallback, useEffect, useMemo, useState } from 'react';
import { Blur, Canvas, Image, Rect, Skia } from '@shopify/react-native-skia';
import {
  ActivityIndicator,
  Button,
  PixelRatio,
  Platform,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import {
  useVideoPlayer,
  type BufferingRange,
} from '@sheunglaili/react-native-skia-video';
import Slider from '@react-native-community/slider';
import Animated, {
  useAnimatedProps,
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
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);

  const loadRandomVideo = useCallback(() => {
    setLoading(true);
    setVideo(null);
    setLoadedRanges([]);
    setPlaybackSpeed(1.0);
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

  const aspectRatio = video ? video.width / video.height : 16 / 9;
  const { width: windowWidth } = useWindowDimensions();
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

  const resolution = useMemo(
    () => ({
      width: videoDimensions.width * PixelRatio.get(),
      height: videoDimensions.height * PixelRatio.get(),
    }),
    [videoDimensions]
  );

  const canvasDimensions = useMemo(
    () => ({
      width: windowWidth,
      height: videoDimensions.height,
    }),
    [windowWidth, videoDimensions.height]
  );

  const { currentFrame, player } = useVideoPlayer({
    uri: video?.video_files.find((file) => file.quality === 'hd')?.link ?? null,
    autoPlay: true,
    isLooping: true,
    playbackSpeed,
    onReadyToPlay,
    onPlayingStatusChange,
    onBufferingUpdate,
    resolution,
  });

  const videoImage = useDerivedValue(() => {
    const frame = currentFrame.value;
    if (!frame) {
      return null;
    }
    try {
      return Skia.Image.MakeImageFromNativeTextureUnstable(
        frame.texture,
        frame.width,
        frame.height
      );
    } catch (e) {
      console.error('Failed to convert native texture to SkImage', e);
      return null;
    }
  });

  const currentTime = useSharedValue<number>(0);
  const duration = useSharedValue<number>(1);
  useFrameCallback(() => {
    currentTime.value = player?.currentTime ?? 0;
    duration.value = player?.duration ?? 0;
  }, true);

  const sliderProps = useAnimatedProps(
    () => ({
      value: currentTime.value,
      maximumValue: duration.value,
    }),
    [currentTime, duration]
  );

  // on android reconciliation of Image component might fails, so we need to avoid rerendering
  // for things like play/pause button change
  const canvas = useMemo(
    () => (
      <Canvas style={canvasDimensions} opaque>
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
      {player &&
        loadedRanges.map((range, index) => (
          <View
            key={index}
            style={{
              position: 'absolute',
              top: canvasDimensions.height,
              left: (range.start / player.duration) * windowWidth,
              width: (range.duration / player.duration) * windowWidth,
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
          animatedProps={sliderProps}
          minimumValue={0}
          onValueChange={(value) => {
            // Trigger continuously on Android
            if (Platform.OS !== 'android') {
              player?.seekTo(value);
            }
          }}
          style={{ alignSelf: 'stretch' }}
          disabled={loading}
          maximumTrackTintColor={'#CCC'}
          minimumTrackTintColor={'#F00'}
        />

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Button
            title={isPlaying ? 'Pause' : 'Play'}
            onPress={() => (isPlaying ? player?.pause() : player?.play())}
            disabled={loading}
          />
          <Text style={{ color: '#000', fontSize: 16, fontWeight: '600' }}>
            Speed: {playbackSpeed}x
          </Text>
        </View>
        <Button
          title={'Load Random Video'}
          onPress={loadRandomVideo}
          disabled={loading}
        />
        <Button
          title={blur ? 'Unblur' : 'Blur'}
          onPress={() => setBlur((blur) => !blur)}
        />
        <View
          style={{
            flexDirection: 'row',
            gap: 10,
            flexWrap: 'wrap',
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          {[0.5, 0.75, 1.0, 1.25, 1.5, 2.0].map((speed) => (
            <Button
              key={speed}
              title={`${speed}x`}
              onPress={() => setPlaybackSpeed(speed)}
              color={playbackSpeed === speed ? '#007AFF' : undefined}
              disabled={loading}
            />
          ))}
        </View>
        <Button
          title={`Reset Speed`}
          onPress={() => setPlaybackSpeed(1.0)}
          disabled={loading}
        />
      </View>
    </View>
  );
};

export default VideoPlayerExample;

const AnimatedSlider = Animated.createAnimatedComponent(Slider);
