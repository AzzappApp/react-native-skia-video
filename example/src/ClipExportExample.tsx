import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Platform, View, useWindowDimensions } from 'react-native';
import { launchImageLibrary } from 'react-native-image-picker';
import ReactNativeBlobUtil from 'react-native-blob-util';
import { createId } from '@paralleldrive/cuid2';
import {
  exportVideoComposition,
  getValidEncoderConfigurations,
  useVideoPlayer,
  type FrameDrawer,
  type VideoComposition,
  type VideoDimensions,
} from '@azzapp/react-native-skia-video';
import {
  drawFrameFitted,
  uprightSize,
  VideoFrameCanvas,
} from './helpers/frames';
import {
  formatBytes,
  formatDuration,
  openVideoFile,
  pathFromUri,
} from './helpers/files';
import {
  AppText,
  Button,
  Card,
  ChipGroup,
  ProgressBar,
  Screen,
  Tag,
  styles,
} from './ui';
import { spacing } from './theme';

/**
 * Exports a clip of the library alone, at a chosen frame rate, and plays the
 * export next to the original.
 *
 * Made to check frame timing: a clip recorded with a phone's camera is
 * variable frame rate, and exported at its own rate every frame should show
 * once (see issue #89, where some frames were shown twice and the next ones
 * skipped). Playing the export slowed down makes a repeated frame easy to
 * spot on fast movements.
 */

const FRAME_RATES = [24, 25, 30, 60] as const;
type FrameRate = (typeof FRAME_RATES)[number];

// The long side of the export, and its bit rate.
const QUALITIES = {
  '720p': { longSide: 1280, bitRate: 6_000_000 },
  '1080p': { longSide: 1920, bitRate: 12_000_000 },
  '4K': { longSide: 3840, bitRate: 40_000_000 },
} as const;
type Quality = keyof typeof QUALITIES;

const SPEEDS = [1, 0.5, 0.25] as const;

// Counts the frames of a video that repeat the previous one.
const FFMPEG_DUPLICATES_COMMAND =
  'ffmpeg -i export.mp4 -vf mpdecimate -loglevel debug -f null - 2>&1 | grep -c " drop "';
type Speed = (typeof SPEEDS)[number];

type Clip = {
  uri: string;
  name: string;
  fileSize?: number;
};

type Exported = {
  uri: string;
  path: string;
  frameRate: number;
  frames: number;
  seconds: number;
};

/** What the player reports of a video once it is ready. */
type VideoInfo = VideoDimensions & { duration: number };

// The clip is the composition's only item.
const CLIP_ID = 'clip';

const drawClip: FrameDrawer = ({ canvas, frames, width, height }) => {
  'worklet';
  const frame = frames[CLIP_ID];
  if (frame) {
    drawFrameFitted(canvas, frame, width, height, 'cover');
  }
};

/** The size of the export: the clip's, upright, scaled down to `longSide`. */
const exportSize = (info: VideoInfo, longSide: number) => {
  const upright = uprightSize(info);
  const scale = Math.min(1, longSide / Math.max(upright.width, upright.height));
  // Even sizes: the encoders work in 4:2:0.
  const even = (value: number) => Math.max(2, 2 * Math.round(value / 2));
  return {
    width: even(upright.width * scale),
    height: even(upright.height * scale),
  };
};

const ClipExportExample = () => {
  const [clip, setClip] = useState<Clip | null>(null);
  const [frameRate, setFrameRate] = useState<FrameRate>(30);
  const [quality, setQuality] = useState<Quality>('1080p');
  const [speed, setSpeed] = useState<Speed>(1);
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [exported, setExported] = useState<Exported | null>(null);
  const [showing, setShowing] = useState<'export' | 'original'>('export');
  // What the player reported of each video it played, by URI.
  const [infos, setInfos] = useState<Record<string, VideoInfo>>({});
  const abortControllerRef = useRef<AbortController | null>(null);

  const playingUri = exporting
    ? null
    : exported && showing === 'export'
      ? exported.uri
      : (clip?.uri ?? null);

  const onError = useCallback((error: unknown) => {
    Alert.alert(
      'Could not play the video',
      error instanceof Error ? error.message : String(error)
    );
  }, []);

  // Made again with each player: a player reports its own video.
  const playerRef = useRef<{ duration: number } | null>(null);
  const onReadyToPlay = useCallback(
    (dimensions: VideoDimensions) => {
      if (playingUri == null) {
        return;
      }
      const duration = playerRef.current?.duration ?? 0;
      setInfos((previous) => ({
        ...previous,
        [playingUri]: { ...dimensions, duration },
      }));
    },
    [playingUri]
  );

  const { currentFrame, player } = useVideoPlayer({
    uri: playingUri,
    autoPlay: true,
    isLooping: true,
    playbackSpeed: speed,
    onReadyToPlay,
    onError,
  });
  useEffect(() => {
    playerRef.current = player;
  }, [player]);

  const pickClip = useCallback(async () => {
    const result = await launchImageLibrary({
      mediaType: 'video',
      selectionLimit: 1,
      // The file as recorded: no transcoding, which would change its frame
      // timing.
      assetRepresentationMode: 'current',
    });
    if (result.didCancel) {
      return;
    }
    const asset = result.assets?.[0];
    if (result.errorCode || asset?.uri == null) {
      Alert.alert(
        'Could not open the video',
        result.errorMessage ?? result.errorCode ?? 'No video was returned'
      );
      return;
    }
    setClip({
      uri: asset.uri,
      name: asset.fileName ?? 'Video',
      fileSize: asset.fileSize,
    });
    setExported(null);
    setShowing('export');
    setSpeed(1);
  }, []);

  const clipInfo = clip ? infos[clip.uri] : undefined;

  const exportClip = useCallback(() => {
    if (!clip || !clipInfo || clipInfo.duration <= 0) {
      return;
    }
    const { longSide, bitRate } = QUALITIES[quality];
    const size = exportSize(clipInfo, longSide);
    const requested = { ...size, frameRate, bitRate };
    const configs =
      Platform.OS === 'android'
        ? getValidEncoderConfigurations(
            requested.width,
            requested.height,
            requested.frameRate,
            requested.bitRate
          )
        : [requested];
    const config = configs?.[0];
    if (config == null) {
      Alert.alert(
        'No encoder for these settings',
        `${requested.width}×${requested.height} at ${frameRate} fps can't be encoded on this device: try a smaller size.`
      );
      return;
    }

    const composition: VideoComposition = {
      duration: clipInfo.duration,
      items: [
        {
          id: CLIP_ID,
          path: pathFromUri(clip.uri),
          compositionStartTime: 0,
          startTime: 0,
          duration: clipInfo.duration,
          // Decoded at the size of the export, not larger.
          maxLongSide: Math.max(config.width, config.height),
          audio: true,
        },
      ],
    };
    const path = `${ReactNativeBlobUtil.fs.dirs.CacheDir}/${createId()}.mp4`;
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    setExporting(true);
    setExported(null);
    setProgress(0);
    const startedAt = Date.now();
    // Started once the player is released: on Android, a decoder may fail
    // while the graphic memory is still held by the player's.
    setTimeout(() => {
      exportVideoComposition({
        videoComposition: composition,
        drawFrame: drawClip,
        abortSignal: abortController.signal,
        onProgress: ({ framesCompleted, nbFrames }) =>
          setProgress(framesCompleted / nbFrames),
        outPath: path,
        ...config,
      }).then(
        () => {
          abortControllerRef.current = null;
          setExporting(false);
          setShowing('export');
          setExported({
            uri: `file://${path}`,
            path,
            frameRate: config.frameRate,
            frames: Math.ceil(composition.duration * config.frameRate),
            seconds: (Date.now() - startedAt) / 1000,
          });
        },
        (error) => {
          abortControllerRef.current = null;
          setExporting(false);
          if (!abortController.signal.aborted) {
            Alert.alert(
              'Could not export the video',
              error instanceof Error ? error.message : String(error)
            );
          }
        }
      );
    }, 100);
  }, [clip, clipInfo, frameRate, quality]);

  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const stageWidth = windowWidth - 2 * spacing.lg;
  const stageHeight = Math.min(stageWidth * 1.25, windowHeight * 0.5);

  if (clip == null) {
    return (
      <Screen>
        <Card>
          <Tag label="Frame timing" />
          <AppText variant="heading">Export a clip of your library</AppText>
          <AppText variant="muted">
            Pick a video recorded with your phone’s camera. It’s exported alone,
            at the frame rate you choose: use the clip’s own, 30 fps for most
            phone videos, then play the export slowed down. On fast movements,
            every frame should show once, none repeated or skipped.
          </AppText>
          <Button title="Choose a video" onPress={pickClip} />
        </Card>
      </Screen>
    );
  }

  return (
    <Screen>
      {exporting ? (
        <Card>
          <AppText variant="heading">Exporting…</AppText>
          <ProgressBar progress={progress} />
          <AppText variant="muted">
            {Math.round(progress * 100)}% · {frameRate} fps · {quality}
          </AppText>
          <Button
            title="Cancel"
            variant="danger"
            onPress={() => abortControllerRef.current?.abort()}
          />
        </Card>
      ) : (
        <>
          {exported && (
            <ChipGroup
              options={['export', 'original'] as const}
              value={showing}
              onChange={setShowing}
              format={(value) => (value === 'export' ? 'Export' : 'Original')}
            />
          )}
          <VideoFrameCanvas
            frame={currentFrame}
            width={stageWidth}
            height={stageHeight}
          />
          <View style={styles.row}>
            <AppText variant="caption" style={styles.grow}>
              Playback
            </AppText>
            <ChipGroup
              options={SPEEDS}
              value={speed}
              onChange={setSpeed}
              format={(value) => `${value}×`}
            />
          </View>
          <VideoDetails
            title={exported && showing === 'export' ? 'Export' : clip.name}
            info={playingUri ? infos[playingUri] : undefined}
            extra={
              exported && showing === 'export'
                ? `${exported.frameRate} fps · ${exported.frames} frames in ${exported.seconds.toFixed(1)} s`
                : formatBytes(clip.fileSize)
            }
          />
        </>
      )}

      {!exporting && (
        <Card>
          <AppText variant="caption">Frame rate</AppText>
          <ChipGroup
            options={FRAME_RATES}
            value={frameRate}
            onChange={setFrameRate}
            format={(value) => `${value} fps`}
          />
          <AppText variant="caption">Size</AppText>
          <ChipGroup
            options={Object.keys(QUALITIES) as Quality[]}
            value={quality}
            onChange={setQuality}
          />
          <Button
            title={exported ? 'Export again' : 'Export'}
            onPress={exportClip}
            disabled={!clipInfo || clipInfo.duration <= 0}
          />
          <Button
            title="Choose another video"
            variant="secondary"
            onPress={pickClip}
          />
        </Card>
      )}

      {exported && !exporting && (
        <Card>
          <AppText variant="heading">Checking the export</AppText>
          <AppText variant="muted">
            Play it at 0.25× and follow something moving fast: a frame held
            twice as long as the others, then a jump, is a repeated frame. On a
            computer, ffmpeg counts them (compare with the original):
          </AppText>
          <AppText variant="mono" selectable>
            {FFMPEG_DUPLICATES_COMMAND}
          </AppText>
          <Button
            title={
              Platform.OS === 'ios' ? 'Share the export' : 'Open the export'
            }
            variant="secondary"
            onPress={() => openVideoFile(exported.path)}
          />
          <AppText variant="mono" selectable>
            {exported.path}
          </AppText>
        </Card>
      )}
    </Screen>
  );
};

const VideoDetails = ({
  title,
  info,
  extra,
}: {
  title: string;
  info: VideoInfo | undefined;
  extra: string | null;
}) => {
  const upright = info ? uprightSize(info) : null;
  return (
    <View style={{ gap: spacing.xs }}>
      <AppText variant="heading" numberOfLines={1}>
        {title}
      </AppText>
      <AppText variant="muted">
        {[
          upright && `${upright.width}×${upright.height}`,
          info && info.duration > 0 && formatDuration(info.duration),
          extra,
        ]
          .filter(Boolean)
          .join(' · ') || 'Loading…'}
      </AppText>
    </View>
  );
};

export default ClipExportExample;
