import { useCallback, useEffect, useMemo, useState } from 'react';
import { Blur, Canvas, Fill, Image } from 'react-native-skia';
import {
  ActivityIndicator,
  PixelRatio,
  Platform,
  ScrollView,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  useVideoPlayer,
  type BufferingRange,
} from '@azzapp/react-native-skia-video';
import Slider from '@react-native-community/slider';
import Animated, {
  useAnimatedProps,
  useDerivedValue,
  useFrameCallback,
  useSharedValue,
} from 'react-native-reanimated';
import type { Video } from 'pexels';
import pexelsClient, { hasPexelsApiKey } from './helpers/pexelsClient';
import { colors, sliderColors, spacing } from './theme';
import {
  AppText,
  Button,
  Card,
  ChipGroup,
  Screen,
  ToggleRow,
  styles,
} from './ui';

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
type Speed = (typeof SPEEDS)[number];

const VideoPlayerExample = () => {
  const [video, setVideo] = useState<Video | null>(null);
  const [loadedRanges, setLoadedRanges] = useState<BufferingRange[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [blur, setBlur] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<Speed>(1);

  const loadRandomVideo = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    setVideo(null);
    setLoadedRanges([]);
    setPlaybackSpeed(1);
    pexelsClient.videos
      .popular({ per_page: 1, page: Math.round(Math.random() * 1000) })
      .then(
        (response) => {
          if ('error' in response) {
            setLoadError('The Pexels API request failed, try again.');
            return;
          }
          setVideo(response.videos[0] ?? null);
        },
        () => {
          setLoadError('The Pexels API request failed, try again.');
        }
      );
  }, []);

  useEffect(() => {
    if (hasPexelsApiKey) {
      loadRandomVideo();
    }
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

  const videoImage = useDerivedValue(() => currentFrame.value?.image ?? null);

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
      <Canvas style={canvasDimensions} android={{ backingView: 'SurfaceView' }}>
        <Fill color="#05070A" />
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

  const insets = useSafeAreaInsets();

  if (!hasPexelsApiKey) {
    return (
      <Screen>
        <Card>
          <AppText variant="heading">A Pexels API key is needed</AppText>
          <AppText variant="muted">
            This example streams videos from Pexels. Get a free key at
            pexels.com/api and set it in example/src/helpers/pexelsClient.ts.
          </AppText>
        </Card>
      </Screen>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View>
        {canvas}
        {loading && (
          <ActivityIndicator
            size="large"
            color={colors.accent}
            style={{
              position: 'absolute',
              top: canvasDimensions.height / 2 - 18,
              left: canvasDimensions.width / 2 - 18,
            }}
          />
        )}
      </View>
      <View style={{ height: 3, backgroundColor: colors.surface }}>
        {player &&
          loadedRanges.map((range, index) => (
            <View
              key={index}
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: (range.start / player.duration) * windowWidth,
                width: (range.duration / player.duration) * windowWidth,
                backgroundColor: colors.accentSoft,
              }}
            />
          ))}
      </View>
      <ScrollView
        contentContainerStyle={{
          padding: spacing.lg,
          paddingBottom: spacing.xl + insets.bottom,
          gap: spacing.lg,
        }}
      >
        <AnimatedSlider
          {...sliderColors}
          animatedProps={sliderProps}
          minimumValue={0}
          onValueChange={(value) => {
            // Trigger continuously on Android
            if (Platform.OS !== 'android') {
              player?.seekTo(value);
            }
          }}
          onSlidingComplete={(value) => {
            if (Platform.OS === 'android') {
              player?.seekTo(value);
            }
          }}
          disabled={loading}
        />
        {loadError != null && (
          <AppText style={{ color: colors.danger }}>{loadError}</AppText>
        )}
        <View style={styles.row}>
          <Button
            title={isPlaying ? 'Pause' : 'Play'}
            onPress={() => (isPlaying ? player?.pause() : player?.play())}
            disabled={loading}
            style={styles.grow}
          />
          <Button
            title="Another video"
            variant="secondary"
            onPress={loadRandomVideo}
            disabled={loading && loadError == null}
            style={styles.grow}
          />
        </View>
        <Card>
          <AppText variant="caption">Speed</AppText>
          <ChipGroup
            options={SPEEDS}
            value={playbackSpeed}
            onChange={setPlaybackSpeed}
            format={(speed) => `${speed}×`}
            disabled={loading}
          />
          <ToggleRow label="Blur" value={blur} onValueChange={setBlur} />
        </Card>
      </ScrollView>
    </View>
  );
};

export default VideoPlayerExample;

const AnimatedSlider = Animated.createAnimatedComponent(Slider);
