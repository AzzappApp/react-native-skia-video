import { useCallback, useEffect, useState } from 'react';
import { Blur, Canvas, Image, Rect, Skia } from '@shopify/react-native-skia';
import {
  ActivityIndicator,
  Button,
  View,
  useWindowDimensions,
} from 'react-native';
import { useVideoPlayer } from '@azzapp/react-native-skia-video';
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
  const [loading, setLoading] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [blur, setBlur] = useState(false);

  const loadRandomVideo = useCallback(() => {
    setLoading(true);
    setVideo(null);
    pexelsClient.videos
      .popular({ per_page: 1, page: Math.round(Math.random() * 1000) })
      .then((response) => {
        if ('error' in response) {
          console.error(response.error);
          return;
        }
        setVideo(response.videos[0] ?? null);
      }, console.error);
  }, []);

  useEffect(() => {
    loadRandomVideo();
  }, [loadRandomVideo]);

  const { currentFrame, player } = useVideoPlayer({
    uri: video?.video_files.find((file) => file.quality === 'hd')?.link ?? null,
    isLooping: true,
    onReadyToPlay() {
      setLoading(false);
    },
    onPlayingStatusChange(isPlaying) {
      setIsPlaying(isPlaying);
    },
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
  const videoDimensions =
    aspectRatio >= 1
      ? {
          width: windowWidth,
          height: windowWidth / aspectRatio,
        }
      : {
          width: windowWidth * aspectRatio,
          height: windowWidth,
        };

  const canvasDimensions = {
    width: windowWidth,
    height: videoDimensions.height,
  };

  return (
    <View style={{ flex: 1 }}>
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
      <View style={{ flex: 1, gap: 20, alignItems: 'center' }}>
        <AnimatedSlider
          value={currentTime}
          minimumValue={0}
          maximumValue={video?.duration ?? 0}
          onValueChange={(value) => {
            player?.seekTo(value * 1000);
          }}
          style={{ alignSelf: 'stretch' }}
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
