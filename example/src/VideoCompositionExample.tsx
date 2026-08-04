import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import pexelsClient from './helpers/pexelsClient';
import type { Video } from 'pexels';
import {
  FlatList,
  Image,
  type ListRenderItem,
  TouchableOpacity,
  Button,
  useWindowDimensions,
  View,
  ActivityIndicator,
  Text,
  Platform,
  Alert,
  Switch,
} from 'react-native';
import {
  createNativeStackNavigator,
  type NativeStackScreenProps,
} from '@react-navigation/native-stack';
import {
  exportVideoComposition,
  getValidEncoderConfigurations,
  useVideoCompositionPlayer,
} from '@azzapp/react-native-skia-video';
import {
  type FrameDrawer,
  type VideoComposition,
} from '@azzapp/react-native-skia-video';
import ReactNativeBlobUtil, {
  type FetchBlobResponse,
  type StatefulPromise,
} from 'react-native-blob-util';
import {
  Canvas,
  Image as ImageSkia,
  Skia,
  type SkImage,
} from '@shopify/react-native-skia';
import { createId } from '@paralleldrive/cuid2';
import Slider from '@react-native-community/slider';
import Animated, {
  useAnimatedProps,
  useFrameCallback,
  useSharedValue,
} from 'react-native-reanimated';

const AnimatedSlider = Animated.createAnimatedComponent(Slider);

type StackParamList = {
  SelectVideos: undefined;
  PreviewComposition: { videos: Video[] };
};

const Stack = createNativeStackNavigator<StackParamList>();

const VideoCompositionExample = () => {
  return (
    <Stack.Navigator>
      <Stack.Screen
        name="SelectVideos"
        options={{
          title: 'Select a set of video',
        }}
        component={PexelsVideoPicker}
      />
      <Stack.Screen
        name="PreviewComposition"
        options={{
          title: 'Preview Composition',
        }}
        component={VideoCompositionPreview}
      />
    </Stack.Navigator>
  );
};

export default VideoCompositionExample;

const PexelsVideoPicker = ({
  navigation,
}: NativeStackScreenProps<StackParamList>) => {
  const [videos, setVideos] = useState<Video[]>([]);
  const [selectedVideos, setSelectedVideos] = useState<Set<number>>(new Set());
  const [page, setPage] = useState(1);
  const isLoading = useRef(true);

  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Button
          title="Next"
          onPress={() => {
            navigation.navigate('PreviewComposition', {
              videos: videos.filter((video) => selectedVideos.has(video.id)),
            });
          }}
        />
      ),
    });
  }, [navigation, selectedVideos, videos]);

  const { width: windowWidth } = useWindowDimensions();

  const loadVideos = useCallback(async (page: number) => {
    const response = await pexelsClient.videos.popular({ per_page: 50, page });
    if ('error' in response) {
      console.error(response.error);
      return;
    }
    setVideos((videos) =>
      page === 1 ? response.videos : [...videos, ...response.videos]
    );
    isLoading.current = false;
  }, []);

  useEffect(() => {
    loadVideos(page);
  }, [loadVideos, page]);

  const keyExtractor = useCallback((video: Video) => video.id.toString(), []);

  const onSelectVideo = useCallback((id: number) => {
    setSelectedVideos((selectedVideos) => {
      const newSelectedVideos = new Set(selectedVideos);
      if (selectedVideos.has(id)) {
        newSelectedVideos.delete(id);
      } else {
        newSelectedVideos.add(id);
      }
      return newSelectedVideos;
    });
  }, []);

  const renderItem = useCallback<ListRenderItem<Video>>(
    ({ item: video }) => (
      <TouchableOpacity onPress={() => onSelectVideo(video.id)}>
        <Image
          source={{ uri: video.image }}
          style={{
            width: windowWidth / 4,
            height: windowWidth / 4,
            borderWidth: 2,
            borderColor: selectedVideos.has(video.id) ? 'blue' : 'transparent',
          }}
        />
      </TouchableOpacity>
    ),
    [onSelectVideo, selectedVideos, windowWidth]
  );

  const onEndReached = useCallback(() => {
    isLoading.current = true;
    setPage((page) => page + 1);
  }, []);

  return (
    <FlatList
      data={videos}
      keyExtractor={keyExtractor}
      renderItem={renderItem}
      style={{ flex: 1 }}
      numColumns={4}
      onEndReached={onEndReached}
    />
  );
};

const MUSIC_URL =
  'https://archive.org/download/OpenGoldbergVariations/Kimiko%20Ishizaka%20-%20J.S.%20Bach-%20-Open-%20Goldberg%20Variations%2C%20BWV%20988%20%28Piano%29%20-%2001%20Aria.mp3';

const drawFrame: FrameDrawer = ({
  videoComposition,
  canvas,
  currentTime,
  frames,
  height,
  width,
}) => {
  'worklet';
  const items = videoComposition.items.filter(
    (item) =>
      item.kind !== 'audio' &&
      item.compositionStartTime <= currentTime &&
      item.compositionStartTime + item.duration >= currentTime
  );

  const paint = Skia.Paint();

  const durationMS = videoComposition.duration;

  // A single SkImage recycled (outputImage) for every item of the tick:
  // drawImageRect captures the underlying Skia image synchronously, so the
  // wrapper can be safely rebound to the next item's texture.
  let reusableImage: SkImage | undefined;
  for (const item of items) {
    const frame = frames[item.id];
    if (!frame) {
      return;
    }

    const itemStartTime = item.compositionStartTime;
    const itemEndTime = item.compositionStartTime + item.duration;

    paint.setAlphaf(
      itemStartTime === 0 || currentTime > itemStartTime + 1
        ? currentTime < itemEndTime - 1 || itemEndTime === durationMS
          ? 1
          : 1 - (currentTime - itemEndTime)
        : currentTime - itemStartTime
    );
    let image: SkImage;
    try {
      image = Skia.Image.MakeImageFromNativeTextureUnstable(
        frame.texture,
        frame.width,
        frame.height,
        false,
        reusableImage
      );
      reusableImage = image;
    } catch (error) {
      console.log('error', error);
      continue;
    }
    const frameAspectRatio = frame.width / frame.height;
    const aspectRatio = width / height;

    canvas.drawImageRect(
      image,
      frameAspectRatio > aspectRatio
        ? {
            x: frame.width / 2 - (frame.height * aspectRatio) / 2,
            y: 0,
            width: frame.height * aspectRatio,
            height: frame.height,
          }
        : {
            x: 0,
            y: frame.height / 2 - frame.width / aspectRatio / 2,
            width: frame.width,
            height: frame.width / aspectRatio,
          },
      { x: 0, y: 0, width, height },
      paint
    );
  }
};

const VideoCompositionPreview = ({
  route: {
    params: { videos },
  },
}: NativeStackScreenProps<StackParamList, 'PreviewComposition'>) => {
  const [baseComposition, setBaseComposition] =
    useState<VideoComposition | null>(null);
  const [musicPath, setMusicPath] = useState<string | null>(null);
  const [musicEnabled, setMusicEnabled] = useState(true);

  useEffect(() => {
    const promises: StatefulPromise<any>[] = [];

    const fetchFiles = async () => {
      const musicFilePath = `${ReactNativeBlobUtil.fs.dirs.CacheDir}/open-goldberg-aria.mp3`;
      let musicPromise: StatefulPromise<FetchBlobResponse> | null = null;
      if (!(await ReactNativeBlobUtil.fs.exists(musicFilePath))) {
        musicPromise = ReactNativeBlobUtil.config({
          path: musicFilePath,
        }).fetch('GET', MUSIC_URL);
        promises.push(musicPromise);
      }

      const videoUrls: Record<number, StatefulPromise<FetchBlobResponse>> = {};
      for (const video of videos) {
        const uri =
          video.video_files.find((file) => file.quality === 'hd')?.link ??
          video.video_files[0]?.link ??
          null;

        if (uri != null) {
          const promise = ReactNativeBlobUtil.config({
            fileCache: true,
            appendExt: uri.split('.').pop() ?? 'mp4',
          }).fetch('GET', uri);
          promises.push(promise);
          videoUrls[video.id] = promise;
        }
      }
      let videoFiles: { id: number; path: string }[] = [];
      try {
        videoFiles = await Promise.all(
          Object.entries(videoUrls).map(async ([id, promise]) => {
            const response = await promise;
            const status = response.info().status;
            if (status !== 200) {
              throw new Error(
                `Could not download video ${id} (status ${status})`
              );
            }
            return { id: Number(id), path: response.path() };
          })
        );
      } catch (error) {
        if (!(error instanceof ReactNativeBlobUtil.CanceledFetchError)) {
          console.error(error);
        }
        return;
      }
      try {
        if (musicPromise != null) {
          const musicResponse = await musicPromise;
          const status = musicResponse.info().status;
          if (status !== 200) {
            throw new Error(
              `Could not download the background music (status ${status})`
            );
          }
        }
        setMusicPath(musicFilePath);
      } catch (error) {
        await ReactNativeBlobUtil.fs.unlink(musicFilePath).catch(() => {});
        if (!(error instanceof ReactNativeBlobUtil.CanceledFetchError)) {
          console.error(error);
        }
      }
      const videoWithFiles = videos
        .map((video) => ({
          ...video,
          path: videoFiles.find((file) => file.id === video.id)?.path ?? null,
        }))
        .filter((video) => video.path != null);

      let currentTime = 0;
      const composition: VideoComposition = {
        duration: videoWithFiles.reduce(
          (acc, video) => acc + Math.min(Math.max(2, video.duration), 5) - 1,
          1
        ),
        items: videoWithFiles.map((video) => {
          const duration = Math.min(Math.max(2, video.duration), 5);
          const item = {
            id: video.id.toString(),
            path: video.path!,
            startTime: 0,
            compositionStartTime: currentTime,
            duration,
            audio: true,
          };
          currentTime += duration - 1;
          return item;
        }),
      };
      setBaseComposition(composition);
    };

    fetchFiles();

    return () => {
      promises.forEach((promise) => {
        promise.cancel();
      });
    };
  }, [videos]);

  const videoComposition = useMemo<VideoComposition | null>(() => {
    if (!baseComposition) {
      return null;
    }
    if (!musicEnabled || !musicPath) {
      return baseComposition;
    }
    return {
      ...baseComposition,
      items: [
        ...baseComposition.items,
        {
          id: 'music',
          kind: 'audio',
          path: musicPath,
          compositionStartTime: 0,
          startTime: 0,
          duration: baseComposition.duration,
          volume: 0.3,
        },
      ],
    };
  }, [baseComposition, musicEnabled, musicPath]);

  const [exporting, setExporting] = useState(false);
  const [exportedPath, setExportedPath] = useState<string | null>(null);
  const [exportProgress, setExportProgress] = useState(0);

  const exportCurrentComposition = useCallback(() => {
    if (!videoComposition) {
      return;
    }
    setExporting(true);

    // We need to wait a bit to let the UI unmount the player
    // before starting the export, especially on Android where
    // Some codec will crash if graphic memory is saturated
    setTimeout(() => {
      const requestedConfigs = {
        bitRate: 12000000,
        frameRate: 60,
        width: 1920,
        height: 1920,
      };

      const validConfigs =
        Platform.OS === 'android'
          ? getValidEncoderConfigurations(
              requestedConfigs.width,
              requestedConfigs.height,
              requestedConfigs.frameRate,
              requestedConfigs.bitRate
            )
          : [requestedConfigs];
      if (!validConfigs || validConfigs.length === 0) {
        Alert.alert("Couldn't find a valid encoder configuration");
        setExporting(false);
        return;
      }

      const encoderConfigs = validConfigs[0]!;

      const outPath =
        ReactNativeBlobUtil.fs.dirs.CacheDir + '/' + createId() + '.mp4';
      exportVideoComposition({
        videoComposition,
        drawFrame,
        onProgress: (progress) =>
          setExportProgress(progress.framesCompleted / progress.nbFrames),
        outPath,
        ...encoderConfigs,
      }).then(
        () => {
          setExportedPath(outPath);
        },
        (error) => {
          Alert.alert('Error exporting video', error.message);
          setExporting(false);
        }
      );
    }, 100);
  }, [videoComposition]);

  const { width: windowWidth } = useWindowDimensions();

  const onPlayerError = useCallback((error: any, retry: () => void) => {
    console.error('Composition player error:', error);
    Alert.alert('Composition player error', String(error?.message ?? error), [
      { text: 'Retry', onPress: retry },
      { text: 'Cancel' },
    ]);
  }, []);

  const { currentFrame, player } = useVideoCompositionPlayer({
    composition: exporting ? null : videoComposition,
    autoPlay: true,
    isLooping: true,
    drawFrame,
    width: windowWidth,
    height: windowWidth,
    onError: onPlayerError,
  });

  const [isPlaying, setIsPlaying] = useState(true);
  const duration = videoComposition?.duration ?? 0;

  // The composition extractor exposes `currentTime` as a native getter, so it
  // has to be polled from the UI thread to drive the slider.
  const currentTime = useSharedValue(0);
  useFrameCallback(() => {
    currentTime.value = player?.currentTime ?? 0;
  }, true);

  const sliderProps = useAnimatedProps(
    () => ({ value: currentTime.value }),
    [currentTime]
  );

  const seekTo = useCallback(
    (time: number) => {
      player?.seekTo(time);
    },
    [player]
  );

  return (
    <View style={{ flex: 1 }}>
      {!exporting && (
        <>
          <View
            style={{
              flex: 1,
              gap: 20,
              alignItems: 'center',
            }}
          >
            <Canvas
              style={{
                width: windowWidth,
                height: windowWidth,
              }}
              opaque
            >
              <ImageSkia
                image={currentFrame}
                x={0}
                y={0}
                width={windowWidth}
                height={windowWidth}
              />
            </Canvas>
            <View
              style={{
                opacity: videoComposition ? 1 : 0,
                alignSelf: 'stretch',
                gap: 10,
                alignItems: 'center',
              }}
            >
              <AnimatedSlider
                animatedProps={sliderProps}
                minimumValue={0}
                maximumValue={duration}
                onValueChange={(value) => {
                  // Fires continuously on Android, only seek on release there.
                  if (Platform.OS !== 'android') {
                    seekTo(value);
                  }
                }}
                onSlidingComplete={(value) => {
                  if (Platform.OS === 'android') {
                    seekTo(value);
                  }
                }}
                style={{ alignSelf: 'stretch' }}
                disabled={!videoComposition}
                maximumTrackTintColor={'#CCC'}
                minimumTrackTintColor={'#F00'}
              />
              <View
                style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}
              >
                <Text style={{ color: 'black' }}>Background music</Text>
                <Switch
                  value={musicEnabled && musicPath != null}
                  disabled={musicPath == null}
                  onValueChange={setMusicEnabled}
                />
              </View>
              <View
                style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}
              >
                <Button
                  title={isPlaying ? 'Pause' : 'Play'}
                  onPress={() => {
                    if (isPlaying) {
                      player?.pause();
                    } else {
                      player?.play();
                    }
                    setIsPlaying(!isPlaying);
                  }}
                />
                <Button
                  title="Export"
                  onPress={() => {
                    exportCurrentComposition();
                  }}
                />
              </View>
            </View>
          </View>
          {!videoComposition && (
            <View
              style={{
                position: 'absolute',
                top: 100,
                left: 0,
                width: '100%',
                gap: 20,
                alignItems: 'center',
              }}
            >
              <ActivityIndicator size="large" />
              <Text style={{ color: 'black' }}>
                Dowloading the video files...
              </Text>
            </View>
          )}
        </>
      )}
      {exporting && (
        <View
          style={{
            flex: 1,
            marginTop: 100,
            gap: 20,
            alignItems: 'center',
          }}
        >
          {exportedPath ? (
            <Text style={{ color: 'black' }}>
              Video exported successfully! at {exportedPath}
            </Text>
          ) : (
            <>
              <ActivityIndicator size="large" />
              <Text style={{ color: 'black' }}>
                Exporting video {Math.round(exportProgress * 100)}%...
              </Text>
            </>
          )}
        </View>
      )}
    </View>
  );
};
