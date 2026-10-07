import ReactNativeBlobUtil from 'react-native-blob-util';
import { scheduleOnRN } from 'react-native-worklets';
import { exportVideoComposition } from '@azzapp/react-native-skia-video';
import {
  buildComposition,
  drawItemsGrid,
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
  duration: number;
  output: EncoderConfig;
};

export type PreviewScenario = {
  kind: 'preview';
  id: string;
  label: string;
  clips: string[];
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

export type Scenario = ExportScenario | PreviewScenario | PlayerScenario;

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
];

export const getScenarioClips = (scenario: Scenario) =>
  scenario.kind === 'player' ? [scenario.clip] : scenario.clips;

export type Metrics = Record<string, number | string | Summary | null>;

/**
 * Exports the composition of the scenario and measures, per frame (on the
 * export thread):
 * - `decodeMs`: from the end of the previous frame to the drawing of this one
 *   (decoding the frames of the items and importing them into textures);
 * - `renderEncodeMs`: drawing the frame and handing it to the encoder;
 * - `frameMs`: the whole frame.
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
  const recordFrame = (
    decode: number | null,
    renderEncode: number,
    frame: number | null
  ) => {
    renderEncodeMs.push(renderEncode);
    if (decode != null && frame != null) {
      decodeMs.push(decode);
      frameMs.push(frame);
    }
  };
  const runId = Math.random();
  const outPath = `${ReactNativeBlobUtil.fs.dirs.CacheDir}/rnskv-benchmark-${Date.now()}.mp4`;

  const start = performance.now();
  await exportVideoComposition<number>({
    videoComposition: buildComposition(scenario.clips, scenario.duration),
    drawFrame: scenario.clips.length > 0 ? drawItemsGrid : drawTestPattern,
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
      };
      const previousEnd =
        state.__rnskvBenchmarkRun === runId
          ? state.__rnskvBenchmarkFrameEnd
          : undefined;
      state.__rnskvBenchmarkRun = runId;
      state.__rnskvBenchmarkFrameEnd = end;
      scheduleOnRN(
        recordFrame,
        previousEnd == null ? null : drawStart - previousEnd,
        end - drawStart,
        previousEnd == null ? null : end - previousEnd
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
    fileSize,
  };
};
