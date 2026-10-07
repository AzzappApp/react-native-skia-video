import { useEffect, useMemo } from 'react';
import { useWindowDimensions } from 'react-native';
import { Canvas, Image } from 'react-native-skia';
import {
  runOnUI,
  useAnimatedReaction,
  useDerivedValue,
  useFrameCallback,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
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

/**
 * The samples of a run, taken on the UI thread. They are kept on the UI
 * runtime (plain arrays, cheap to append to every frame) and sent to the JS
 * thread once the run is over.
 */
type Samples = {
  startTime: number | null;
  /** Intervals between two UI frames. */
  uiFrameMs: number[];
  /** Cost of a composition frame (preview). */
  renderMs: number[];
  /** Intervals between two decoded frames (player). */
  decodedFrameMs: number[];
  lastDecodedFrameTime: number | null;
};

let nextRunId = 0;

const getSamples = (runId: number): Samples => {
  'worklet';
  const global = globalThis as unknown as {
    __rnskvBenchmarkSamples?: Record<number, Samples>;
  };
  const allSamples = (global.__rnskvBenchmarkSamples ??= {});
  return (allSamples[runId] ??= {
    startTime: null,
    uiFrameMs: [],
    renderMs: [],
    decodedFrameMs: [],
    lastDecodedFrameTime: null,
  });
};

const isMeasuring = (samples: Samples, now: number) => {
  'worklet';
  return samples.startTime != null && now - samples.startTime >= WARM_UP_MS;
};

/**
 * Samples the intervals between two UI frames, once the warm-up is over, and
 * calls `onDone` with all the samples of the run after `duration` seconds.
 * Returns the id of the run, to add samples with `getSamples`.
 */
const useUIFrameSampling = (
  duration: number,
  onDone: (samples: Samples, elapsedMs: number) => void
) => {
  const runId = useMemo(() => nextRunId++, []);
  useFrameCallback((frameInfo) => {
    'worklet';
    const samples = getSamples(runId);
    const now = performance.now();
    if (samples.startTime == null) {
      samples.startTime = now;
      return;
    }
    if (isMeasuring(samples, now) && frameInfo.timeSincePreviousFrame != null) {
      samples.uiFrameMs.push(frameInfo.timeSincePreviousFrame);
    }
  }, true);

  useEffect(() => {
    const finish = (samples: Samples) => onDone(samples, duration * 1000);
    const timeout = setTimeout(
      () =>
        runOnUI(() => {
          'worklet';
          const samples = getSamples(runId);
          const global = globalThis as unknown as {
            __rnskvBenchmarkSamples: Record<number, Samples>;
          };
          delete global.__rnskvBenchmarkSamples[runId];
          scheduleOnRN(finish, samples);
        })(),
      WARM_UP_MS + duration * 1000
    );
    return () => clearTimeout(timeout);
    // Run once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return runId;
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
  const runId = useUIFrameSampling(scenario.duration, (samples, elapsedMs) =>
    onDone({
      uiFrameMs: summarize(samples.uiFrameMs),
      droppedFrames: countDroppedFrames(samples.uiFrameMs),
      uiFps:
        Math.round((samples.uiFrameMs.length / elapsedMs) * 1000 * 10) / 10,
      renderMs: summarize(samples.renderMs),
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
      const samples = getSamples(runId);
      const now = performance.now();
      if (isMeasuring(samples, now)) {
        samples.renderMs.push(now - start);
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
  const runId = useUIFrameSampling(scenario.duration, (samples, elapsedMs) =>
    onDone({
      uiFrameMs: summarize(samples.uiFrameMs),
      droppedFrames: countDroppedFrames(samples.uiFrameMs),
      decodedFps:
        Math.round((samples.decodedFrameMs.length / elapsedMs) * 1000 * 10) /
        10,
      expectedFps: clip.frameRate,
      decodedFrameIntervalMs: summarize(samples.decodedFrameMs),
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
      const samples = getSamples(runId);
      const now = performance.now();
      if (isMeasuring(samples, now) && samples.lastDecodedFrameTime != null) {
        samples.decodedFrameMs.push(now - samples.lastDecodedFrameTime);
      }
      samples.lastDecodedFrameTime = now;
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
