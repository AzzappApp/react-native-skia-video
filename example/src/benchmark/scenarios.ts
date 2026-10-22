import ReactNativeBlobUtil from 'react-native-blob-util';
import { scheduleOnRN } from 'react-native-worklets';
import { exportVideoComposition } from '@azzapp/react-native-skia-video';
import {
  buildComposition,
  drawItemsGrid,
  drawSequence,
  drawTestPattern,
  resolveEncoderConfig,
  type EncoderConfig,
} from './clips';
import { summarize, type Summary } from './stats';

export type ExportScenario = {
  kind: 'export';
  id: string;
  label: string;
  /** The clips played at the same time (none: the test pattern is drawn). */
  clips: string[];
  /** The clips play one after another instead, see `buildComposition`. */
  sequence?: boolean;
  duration: number;
  output: EncoderConfig;
};

export type PreviewScenario = {
  kind: 'preview';
  id: string;
  label: string;
  clips: string[];
  /** The clips play one after another instead, see `buildComposition`. */
  sequence?: boolean;
  /** The size the clips are decoded at (their own size by default). */
  resolution?: { width: number; height: number };
  /** Measured duration, after a warm-up. */
  duration: number;
};

export type PlayerScenario = {
  kind: 'player';
  id: string;
  label: string;
  clip: string;
  /** Measured duration, after a warm-up. */
  duration: number;
};

/** Exports color bars and reads them back from the decoded video. */
export type ColorScenario = {
  kind: 'color';
  id: string;
  label: string;
};

export type Scenario =
  ExportScenario | PreviewScenario | PlayerScenario | ColorScenario;

const PORTRAIT_1080P: EncoderConfig = {
  width: 1080,
  height: 1920,
  frameRate: 30,
  bitRate: 12_000_000,
};

export const SCENARIOS: Scenario[] = [
  {
    kind: 'export',
    id: 'export-draw-only',
    label: 'Export 1080×1920@30, drawing only (no decoding)',
    clips: [],
    duration: 10,
    output: PORTRAIT_1080P,
  },
  {
    kind: 'export',
    id: 'export-1x1080p30',
    label: 'Export 1080×1920@30, 1 clip 1080p30',
    clips: ['1080p30'],
    duration: 10,
    output: PORTRAIT_1080P,
  },
  {
    kind: 'export',
    id: 'export-3x1080p30',
    label: 'Export 1080×1920@30, 3 clips 1080p30 at once',
    clips: ['1080p30', '1080p30', '1080p30'],
    duration: 10,
    output: PORTRAIT_1080P,
  },
  {
    kind: 'export',
    id: 'export-sequence-8x1080p30',
    label: 'Export 1080×1920@30, 8 clips 1080p30 one after another (3 s each)',
    clips: Array(8).fill('1080p30'),
    sequence: true,
    duration: 24,
    output: PORTRAIT_1080P,
  },
  {
    kind: 'export',
    id: 'export-1x1080p60',
    label: 'Export 1920×1080@60, 1 clip 1080p60',
    clips: ['1080p60'],
    duration: 10,
    output: { width: 1920, height: 1080, frameRate: 60, bitRate: 16_000_000 },
  },
  {
    kind: 'export',
    id: 'export-1x2160p30',
    label: 'Export 3840×2160@30, 1 clip 2160p30',
    clips: ['2160p30'],
    duration: 10,
    output: { width: 3840, height: 2160, frameRate: 30, bitRate: 40_000_000 },
  },
  {
    kind: 'preview',
    id: 'preview-1x1080p30',
    label: 'Composition preview, 1 clip 1080p30',
    clips: ['1080p30'],
    duration: 10,
  },
  {
    kind: 'preview',
    id: 'preview-3x1080p30',
    label: 'Composition preview, 3 clips 1080p30 at once',
    clips: ['1080p30', '1080p30', '1080p30'],
    duration: 10,
  },
  {
    kind: 'preview',
    id: 'preview-sequence-8x1080p30',
    label: 'Composition preview, 8 clips 1080p30 one after another',
    clips: Array(8).fill('1080p30'),
    sequence: true,
    duration: 20,
  },
  {
    kind: 'preview',
    id: 'preview-3x1080p30-at-360p',
    label: 'Composition preview, 3 clips 1080p30 at once, decoded at 640×360',
    clips: ['1080p30', '1080p30', '1080p30'],
    resolution: { width: 640, height: 360 },
    duration: 10,
  },
  {
    kind: 'player',
    id: 'player-1080p30',
    label: 'Video player, 1080p30',
    clip: '1080p30',
    duration: 10,
  },
  {
    kind: 'player',
    id: 'player-1080p60',
    label: 'Video player, 1080p60',
    clip: '1080p60',
    duration: 10,
  },
  {
    kind: 'player',
    id: 'player-2160p30',
    label: 'Video player, 2160p30',
    clip: '2160p30',
    duration: 10,
  },
  {
    kind: 'color',
    id: 'color-check',
    label: 'Colors: export color bars, decode them, compare (max error)',
  },
];

export const getScenarioClips = (scenario: Scenario): string[] =>
  scenario.kind === 'player'
    ? [scenario.clip]
    : scenario.kind === 'color'
      ? []
      : scenario.clips;

export type Metrics = Record<string, number | string | Summary | null>;

// The decoding time from which an export frame is listed in `slowFrames`.
const SLOW_DECODE_MS = 100;

// The most frames listed in `slowFrames`.
const MAX_SLOW_FRAMES = 40;

/**
 * The garbage collections of the calling runtime so far, and the time they
 * took in ms (Hermes only).
 */
const readGCStats = () => {
  'worklet';
  const stats = (
    globalThis as unknown as {
      HermesInternal?: {
        getInstrumentedStats?: () => { js_numGCs?: number; js_gcTime?: number };
      };
    }
  ).HermesInternal?.getInstrumentedStats?.();
  // js_gcTime is in seconds.
  return { count: stats?.js_numGCs ?? 0, ms: (stats?.js_gcTime ?? 0) * 1000 };
};

/**
 * Exports the composition of the scenario and measures, per frame (on the
 * export thread):
 * - `decodeMs`: from the end of the previous frame to the drawing of this one
 *   (decoding the frames of the items and importing them into textures);
 * - `renderEncodeMs`: drawing the frame and handing it to the encoder;
 * - `frameMs`: the whole frame;
 * - `slowFrames`: the frames whose decoding took more than `SLOW_DECODE_MS`,
 *   with their composition time, to match them with what the composition
 *   does then (a clip opened, starting, ending, released), how long they
 *   waited for the native decoders, and the garbage collections of the export
 *   runtime meanwhile.
 */
export const runExportScenario = async (
  scenario: ExportScenario,
  abortSignal: AbortSignal,
  onProgress: (progress: number) => void
): Promise<Metrics> => {
  const config = resolveEncoderConfig(scenario.output);
  if (config == null) {
    throw new Error('No encoder supports this output on this device');
  }
  const decodeMs: number[] = [];
  const renderEncodeMs: number[] = [];
  const frameMs: number[] = [];
  const slowFrames: string[] = [];
  const recordFrame = (
    decode: number | null,
    renderEncode: number,
    frame: number | null,
    time: number,
    decodeWait: number,
    gcCount: number,
    gcMs: number
  ) => {
    renderEncodeMs.push(renderEncode);
    if (decode != null && frame != null) {
      decodeMs.push(decode);
      frameMs.push(frame);
      if (decode > SLOW_DECODE_MS && slowFrames.length < MAX_SLOW_FRAMES) {
        slowFrames.push(
          `${time.toFixed(2)}s ${Math.round(decode)}ms ` +
            `(native ${Math.round(decodeWait)}, ` +
            `gc ${gcCount}/${Math.round(gcMs)}ms)`
        );
      }
    }
  };
  const runId = Math.random();
  const outPath = `${ReactNativeBlobUtil.fs.dirs.CacheDir}/rnskv-benchmark-${Date.now()}.mp4`;

  const draw = scenario.sequence
    ? drawSequence
    : scenario.clips.length > 0
      ? drawItemsGrid
      : drawTestPattern;
  const start = performance.now();
  await exportVideoComposition<number>({
    videoComposition: buildComposition(
      scenario.clips,
      scenario.duration,
      undefined,
      scenario.sequence
    ),
    drawFrame: (info) => {
      'worklet';
      // The time of the frame, for afterDrawFrame.
      (
        globalThis as unknown as { __rnskvBenchmarkTime?: number }
      ).__rnskvBenchmarkTime = info.currentTime;
      draw(info);
    },
    beforeDrawFrame: () => {
      'worklet';
      return performance.now();
    },
    afterDrawFrame: (drawStart) => {
      'worklet';
      const end = performance.now();
      // The end of the previous frame, kept on the export runtime.
      const state = globalThis as unknown as {
        __rnskvBenchmarkRun?: number;
        __rnskvBenchmarkFrameEnd?: number;
        __rnskvBenchmarkTime?: number;
        __rnskvBenchmarkGC?: { count: number; ms: number };
        __rnskvExportDecodeWaitMs?: number;
      };
      const sameRun = state.__rnskvBenchmarkRun === runId;
      const previousEnd = sameRun ? state.__rnskvBenchmarkFrameEnd : undefined;
      const gc = readGCStats();
      const previousGC = (sameRun ? state.__rnskvBenchmarkGC : undefined) ?? gc;
      state.__rnskvBenchmarkRun = runId;
      state.__rnskvBenchmarkFrameEnd = end;
      state.__rnskvBenchmarkGC = gc;
      scheduleOnRN(
        recordFrame,
        previousEnd == null ? null : drawStart - previousEnd,
        end - drawStart,
        previousEnd == null ? null : end - previousEnd,
        state.__rnskvBenchmarkTime ?? 0,
        state.__rnskvExportDecodeWaitMs ?? 0,
        gc.count - previousGC.count,
        gc.ms - previousGC.ms
      );
    },
    abortSignal,
    onProgress: ({ framesCompleted, nbFrames }) =>
      onProgress(framesCompleted / nbFrames),
    outPath,
    ...config,
  });
  const wallMs = performance.now() - start;

  let fileSize: number | null = null;
  try {
    fileSize = Number((await ReactNativeBlobUtil.fs.stat(outPath)).size);
    await ReactNativeBlobUtil.fs.unlink(outPath);
  } catch {
    // The size is only informative.
  }

  const nbFrames = Math.round(scenario.duration * config.frameRate);
  return {
    output: `${config.width}x${config.height}@${config.frameRate}`,
    // Android encoders may only support a smaller output than requested.
    requestedOutput: `${scenario.output.width}x${scenario.output.height}@${scenario.output.frameRate}`,
    wallMs: Math.round(wallMs),
    exportFps: Math.round((nbFrames / wallMs) * 1000 * 10) / 10,
    realtimeFactor:
      Math.round(((scenario.duration * 1000) / wallMs) * 100) / 100,
    frameMs: summarize(frameMs),
    decodeMs: summarize(decodeMs),
    renderEncodeMs: summarize(renderEncodeMs),
    slowFrames: slowFrames.length > 0 ? slowFrames.join('; ') : 'none',
    fileSize,
  };
};
