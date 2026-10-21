import { useEffect, useMemo } from 'react';
import { useWindowDimensions } from 'react-native';
import { Canvas, Image } from 'react-native-skia';
import {
  runOnUI,
  useDerivedValue,
  useFrameCallback,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import {
  useVideoCompositionPlayer,
  useVideoPlayer,
  type FrameDrawer,
  type VideoFrame,
} from '@azzapp/react-native-skia-video';
import {
  buildComposition,
  drawItemsGrid,
  drawSequence,
  getClip,
  getClipPath,
} from './clips';
import type { Metrics, PlayerScenario, PreviewScenario } from './scenarios';
import {
  countDroppedFrames,
  irregularIntervalsPercent,
  summarize,
} from './stats';

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
  /**
   * Cost of turning the decoded frames into images (preview): from the start
   * of the UI frame to the drawing (decodeCompositionFrames and
   * makeVideoFrames in the library).
   */
  prepareMs: number[];
  /** When the current UI frame started. */
  frameStart: number;
  /** The preparation cost and the composition time of the latest frame. */
  lastPrepareMs: number;
  lastCompositionTime: number;
  /**
   * For each interval of `uiFrameMs`, the composition time and the
   * preparation cost of the frame before (preview), see `listSlowFrames`.
   */
  uiFrameAt: number[];
  uiFramePrepareMs: number[];
  /** Intervals between two new frames of a composition item (preview). */
  itemFrameMs: number[];
  /** The image and the time of the latest new frame of each item. */
  lastItemFrames: Record<string, { image: unknown; time: number }>;
  /**
   * The intervals of `itemFrameMs` longer than two frames, see
   * `sampleItemFrames`.
   */
  itemGaps: string[];
  /** Intervals between two decoded frames (player). */
  decodedFrameMs: number[];
  lastDecodedFrame: unknown;
  /** Frames decoded during the whole run, warm-up included. */
  decodedFrames: number;
  lastDecodedFrameTime: number | null;
  /** Start and end of the measurement window. */
  measureStart: number | null;
  measureEnd: number | null;
  /**
   * A UI frame took more than a second: the app was in the background or the
   * screen turned off, the run is not representative.
   */
  interrupted: boolean;
};

// A UI frame longer than this means the app stopped rendering.
const INTERRUPTION_MS = 1000;

// Unique across JS reloads: the UI runtime may outlive a reload, with the
// samples the frame callbacks of a finished run recreated there.
let nextRunId = Date.now();

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
    prepareMs: [],
    frameStart: 0,
    lastPrepareMs: 0,
    lastCompositionTime: 0,
    uiFrameAt: [],
    uiFramePrepareMs: [],
    itemFrameMs: [],
    lastItemFrames: {},
    itemGaps: [],
    decodedFrameMs: [],
    lastDecodedFrame: null,
    decodedFrames: 0,
    lastDecodedFrameTime: null,
    measureStart: null,
    measureEnd: null,
    interrupted: false,
  });
};

// The most slow frames and item gaps listed in a run's metrics.
const MAX_LISTED = 40;

const isMeasuring = (samples: Samples, now: number) => {
  'worklet';
  return samples.startTime != null && now - samples.startTime >= WARM_UP_MS;
};

/**
 * Samples the intervals between two new frames of each item drawn, while it
 * plays (before it starts, an item shows its first frame): a new frame comes
 * with another image (see makeVideoFrame in the library). The intervals
 * longer than two frames are listed with the item and the composition time.
 */
const sampleItemFrames = (
  samples: Samples,
  frames: Record<string, VideoFrame>,
  items: { id: string; compositionStartTime: number; duration: number }[],
  currentTime: number,
  now: number,
  frameMs: number
) => {
  'worklet';
  for (const item of items) {
    const frame = frames[item.id];
    if (
      frame == null ||
      currentTime < item.compositionStartTime ||
      currentTime >= item.compositionStartTime + item.duration
    ) {
      delete samples.lastItemFrames[item.id];
      continue;
    }
    const last = samples.lastItemFrames[item.id];
    if (last?.image === frame.image) {
      continue;
    }
    if (last != null && isMeasuring(samples, now)) {
      const interval = now - last.time;
      samples.itemFrameMs.push(interval);
      if (interval > 2 * frameMs && samples.itemGaps.length < MAX_LISTED) {
        samples.itemGaps.push(
          `${item.id} ${currentTime.toFixed(2)}s ${Math.round(interval)}ms`
        );
      }
    }
    samples.lastItemFrames[item.id] = { image: frame.image, time: now };
  }
};

/**
 * The UI frames longer than 1.5 refresh periods, as "composition time,
 * interval (preparation cost of the frame before)": they can be matched with
 * what the composition does then (an item starting, ending, released).
 */
const listSlowFrames = (samples: Samples) => {
  const period = summarize(samples.uiFrameMs)?.p50;
  if (period == null) {
    return null;
  }
  const slowFrames: string[] = [];
  samples.uiFrameMs.forEach((interval, index) => {
    if (interval > 1.5 * period && slowFrames.length < MAX_LISTED) {
      slowFrames.push(
        `${samples.uiFrameAt[index]!.toFixed(2)}s ${Math.round(interval)}ms ` +
          `(prepare ${samples.uiFramePrepareMs[index]!.toFixed(1)})`
      );
    }
  });
  return slowFrames.length > 0 ? slowFrames.join('; ') : 'none';
};

/**
 * Samples the intervals between two UI frames, once the warm-up is over, and
 * calls `onDone` with all the samples of the run after `duration` seconds.
 * Returns the id of the run, to add samples with `getSamples`.
 */
const useUIFrameSampling = (
  duration: number,
  onError: (error: unknown) => void,
  onDone: (samples: Samples, elapsedMs: number) => void,
  onUIFrame?: (samples: Samples, now: number) => void
) => {
  const runId = useMemo(() => nextRunId++, []);
  useFrameCallback((frameInfo) => {
    'worklet';
    const samples = getSamples(runId);
    const now = performance.now();
    // Registered before the player's frame callback, this one runs first.
    samples.frameStart = now;
    if (samples.startTime == null) {
      samples.startTime = now;
      return;
    }
    onUIFrame?.(samples, now);
    if (!isMeasuring(samples, now)) {
      return;
    }
    samples.measureStart ??= now;
    samples.measureEnd = now;
    const interval = frameInfo.timeSincePreviousFrame;
    if (interval != null) {
      samples.uiFrameMs.push(interval);
      samples.uiFrameAt.push(samples.lastCompositionTime);
      samples.uiFramePrepareMs.push(samples.lastPrepareMs);
      if (interval > INTERRUPTION_MS) {
        samples.interrupted = true;
      }
    }
  }, true);

  useEffect(() => {
    const finish = (samples: Samples) => {
      if (samples.interrupted) {
        onError(
          new Error(
            'Interrupted: the app stopped rendering (background, screen off)'
          )
        );
        return;
      }
      onDone(
        samples,
        samples.measureStart != null && samples.measureEnd != null
          ? samples.measureEnd - samples.measureStart
          : duration * 1000
      );
    };
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
      buildComposition(
        scenario.clips,
        scenario.sequence
          ? (WARM_UP_MS / 1000 + scenario.duration) * 1.1
          : getClip(scenario.clips[0]!).duration,
        scenario.resolution,
        scenario.sequence
      ),
    [scenario]
  );
  const frameMs = 1000 / getClip(scenario.clips[0]!).frameRate;
  const runId = useUIFrameSampling(
    scenario.duration,
    onError,
    (samples, elapsedMs) =>
      onDone({
        uiFrameMs: summarize(samples.uiFrameMs),
        droppedFrames: countDroppedFrames(samples.uiFrameMs),
        uiFps:
          Math.round((samples.uiFrameMs.length / elapsedMs) * 1000 * 10) / 10,
        renderMs: summarize(samples.renderMs),
        prepareMs: summarize(samples.prepareMs),
        slowFrames: listSlowFrames(samples),
        // The cadence of the frames of the items on screen.
        itemFrameIntervalMs: summarize(samples.itemFrameMs),
        expectedFrameMs: Math.round(frameMs * 100) / 100,
        irregularFramesPct: irregularIntervalsPercent(
          samples.itemFrameMs,
          frameMs,
          summarize(samples.uiFrameMs)?.p50
        ),
        itemGaps:
          samples.itemGaps.length > 0 ? samples.itemGaps.join('; ') : 'none',
      })
  );

  const draw = scenario.sequence ? drawSequence : drawItemsGrid;
  const drawFrame: FrameDrawer<number> = (info) => {
    'worklet';
    const samples = getSamples(runId);
    samples.lastCompositionTime = info.currentTime;
    sampleItemFrames(
      samples,
      info.frames,
      info.videoComposition.items,
      info.currentTime,
      performance.now(),
      frameMs
    );
    draw(info);
  };

  const { currentFrame } = useVideoCompositionPlayer<number>({
    composition,
    drawFrame,
    beforeDrawFrame: () => {
      'worklet';
      const samples = getSamples(runId);
      const now = performance.now();
      samples.lastPrepareMs = now - samples.frameStart;
      if (isMeasuring(samples, now)) {
        samples.prepareMs.push(samples.lastPrepareMs);
      }
      return now;
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
    <Canvas
      style={{ width, height: width }}
      android={{ backingView: 'SurfaceView' }}
    >
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
  const { currentFrame } = useVideoPlayer({
    uri: `file://${getClipPath(clip)}`,
    autoPlay: true,
    isLooping: true,
    onError,
  });

  useUIFrameSampling(
    scenario.duration,
    onError,
    (samples, elapsedMs) =>
      onDone({
        uiFrameMs: summarize(samples.uiFrameMs),
        droppedFrames: countDroppedFrames(samples.uiFrameMs),
        decodedFps:
          Math.round((samples.decodedFrameMs.length / elapsedMs) * 1000 * 10) /
          10,
        expectedFps: clip.frameRate,
        decodedFrameIntervalMs: summarize(samples.decodedFrameMs),
        irregularFramesPct: irregularIntervalsPercent(
          samples.decodedFrameMs,
          1000 / clip.frameRate,
          summarize(samples.uiFrameMs)?.p50
        ),
        decodedFramesTotal: samples.decodedFrames,
      }),
    // A new frame was decoded when the player's current frame changes.
    (samples, now) => {
      'worklet';
      const frame = currentFrame.value;
      if (frame == null || frame === samples.lastDecodedFrame) {
        return;
      }
      samples.lastDecodedFrame = frame;
      samples.decodedFrames++;
      if (isMeasuring(samples, now) && samples.lastDecodedFrameTime != null) {
        samples.decodedFrameMs.push(now - samples.lastDecodedFrameTime);
      }
      samples.lastDecodedFrameTime = now;
    }
  );

  const image = useDerivedValue(() => currentFrame.value?.image ?? null);
  const height = (width * clip.height) / clip.width;
  return (
    <Canvas style={{ width, height }} android={{ backingView: 'SurfaceView' }}>
      <Image image={image} x={0} y={0} width={width} height={height} />
    </Canvas>
  );
};
