import { useEffect, useMemo } from 'react';
import { useWindowDimensions } from 'react-native';
import { Canvas, Image } from 'react-native-skia';
import {
  useAnimatedReaction,
  useDerivedValue,
  useFrameCallback,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import {
  useVideoCompositionPlayer,
  useVideoPlayer,
} from '@azzapp/react-native-skia-video';
import { buildComposition, drawItemsGrid, getClip, getClipPath } from './clips';
import type { Metrics, PlayerScenario, PreviewScenario } from './scenarios';
import { countDroppedFrames, summarize } from './stats';

// Samples taken while the decoders start are ignored.
const WARM_UP_MS = 1500;

type LiveRunProps<S> = {
  scenario: S;
  onDone: (metrics: Metrics) => void;
  onError: (error: unknown) => void;
};

const pushSample = (samples: SharedValue<number[]>, value: number) => {
  'worklet';
  samples.modify((values) => {
    'worklet';
    values.push(value);
    return values;
  }, false);
};

/**
 * Measures the UI thread: the intervals between two UI frames, once the
 * warm-up is over. Calls `onDone` with the samples after `duration` seconds.
 */
const useUIFrameSampling = (
  duration: number,
  onDone: (samples: { intervals: number[]; elapsedMs: number }) => void
) => {
  const startTime = useSharedValue<number | null>(null);
  const measuring = useSharedValue(false);
  const intervals = useSharedValue<number[]>([]);
  useFrameCallback((frameInfo) => {
    'worklet';
    const now = performance.now();
    if (startTime.value == null) {
      startTime.value = now;
      return;
    }
    measuring.value = now - startTime.value >= WARM_UP_MS;
    if (measuring.value && frameInfo.timeSincePreviousFrame != null) {
      pushSample(intervals, frameInfo.timeSincePreviousFrame);
    }
  }, true);

  useEffect(() => {
    const timeout = setTimeout(
      () => onDone({ intervals: intervals.value, elapsedMs: duration * 1000 }),
      WARM_UP_MS + duration * 1000
    );
    return () => clearTimeout(timeout);
    // Run once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return measuring;
};

/**
 * Plays the composition of the scenario and measures the cost of each
 * composition frame on the UI thread (decoding, importing and drawing the
 * frames) and the frames missed by the display.
 */
export const PreviewRun = ({
  scenario,
  onDone,
  onError,
}: LiveRunProps<PreviewScenario>) => {
  const { width } = useWindowDimensions();
  const composition = useMemo(
    // Longer than the run: the composition never loops during the
    // measurement.
    () =>
      buildComposition(scenario.clips, getClip(scenario.clips[0]!).duration),
    [scenario]
  );
  const renderMs = useSharedValue<number[]>([]);
  const measuring = useUIFrameSampling(
    scenario.duration,
    ({ intervals, elapsedMs }) =>
      onDone({
        uiFrameMs: summarize(intervals),
        droppedFrames: countDroppedFrames(intervals),
        uiFps: Math.round((intervals.length / elapsedMs) * 1000 * 10) / 10,
        renderMs: summarize(renderMs.value),
      })
  );

  const { currentFrame } = useVideoCompositionPlayer<number>({
    composition,
    drawFrame: drawItemsGrid,
    beforeDrawFrame: () => {
      'worklet';
      return performance.now();
    },
    afterDrawFrame: (start) => {
      'worklet';
      if (measuring.value) {
        pushSample(renderMs, performance.now() - start);
      }
    },
    width,
    height: width,
    autoPlay: true,
    onError,
  });

  return (
    <Canvas style={{ width, height: width }} opaque>
      <Image
        image={currentFrame}
        x={0}
        y={0}
        width={width}
        height={width}
        fit="cover"
      />
    </Canvas>
  );
};

/**
 * Plays the clip of the scenario and measures the rate of the frames decoded
 * and the frames missed by the display.
 */
export const PlayerRun = ({
  scenario,
  onDone,
  onError,
}: LiveRunProps<PlayerScenario>) => {
  const { width } = useWindowDimensions();
  const clip = getClip(scenario.clip);
  const frameIntervals = useSharedValue<number[]>([]);
  const lastFrameTime = useSharedValue<number | null>(null);
  const measuring = useUIFrameSampling(
    scenario.duration,
    ({ intervals, elapsedMs }) =>
      onDone({
        uiFrameMs: summarize(intervals),
        droppedFrames: countDroppedFrames(intervals),
        decodedFps:
          Math.round((frameIntervals.value.length / elapsedMs) * 1000 * 10) /
          10,
        expectedFps: clip.frameRate,
        decodedFrameIntervalMs: summarize(frameIntervals.value),
      })
  );

  const { currentFrame } = useVideoPlayer({
    uri: `file://${getClipPath(clip)}`,
    autoPlay: true,
    isLooping: true,
    onError,
  });

  useAnimatedReaction(
    () => currentFrame.value,
    (frame, previousFrame) => {
      if (frame == null || frame === previousFrame) {
        return;
      }
      const now = performance.now();
      if (measuring.value && lastFrameTime.value != null) {
        pushSample(frameIntervals, now - lastFrameTime.value);
      }
      lastFrameTime.value = now;
    }
  );

  const image = useDerivedValue(() => currentFrame.value?.image ?? null);
  const height = (width * clip.height) / clip.width;
  return (
    <Canvas style={{ width, height }} opaque>
      <Image image={image} x={0} y={0} width={width} height={height} />
    </Canvas>
  );
};
