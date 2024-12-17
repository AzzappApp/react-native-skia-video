import { useCallback, useEffect, useRef, useState } from 'react';
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
      item.compositionStartTime <= currentTime &&
      item.compositionStartTime + item.duration >= currentTime
  );

  const paint = Skia.Paint();

  const durationMS = videoComposition.duration;

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
        frame.height
      );
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
  const [videoComposition, setVideoComposition] =
    useState<VideoComposition | null>(null);

  useEffect(() => {
    const promises: StatefulPromise<any>[] = [];

    const fetchFiles = async () => {
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
            const path = response.path();
            return { id: Number(id), path };
          })
        );
      } catch (error) {
        if (!(error instanceof ReactNativeBlobUtil.CanceledFetchError)) {
          console.error(error);
        }
        return;
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
          };
          currentTime += duration - 1;
          return item;
        }),
      };
      setVideoComposition(composition);
    };

    fetchFiles();

    return () => {
      promises.forEach((promise) => {
        promise.cancel();
      });
    };
  }, [videos]);

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

  const { currentFrame } = useVideoCompositionPlayer({
    composition: exporting ? null : videoComposition,
    autoPlay: true,
    isLooping: true,
    drawFrame,
    width: windowWidth,
    height: windowWidth,
  });

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
            <View style={{ opacity: videoComposition ? 1 : 0 }}>
              <Button
                title="Export"
                onPress={() => {
                  exportCurrentComposition();
                }}
              />
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
