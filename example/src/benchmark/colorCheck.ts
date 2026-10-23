import ReactNativeBlobUtil from 'react-native-blob-util';
import { AlphaType, ColorType, Skia } from 'react-native-skia';
import { scheduleOnRN } from 'react-native-worklets';
import {
  exportVideoComposition,
  type FrameDrawer,
} from '@azzapp/react-native-skia-video';
import { resolveEncoderConfig } from './clips';
import type { Metrics } from './scenarios';

/**
 * Vertical bars of known colors: grays over the whole range, then mid
 * saturated colors (a wrong YCbCr matrix shifts them, not the grays).
 */
const COLOR_BARS: [number, number, number][] = [
  [0, 0, 0],
  [16, 16, 16],
  [32, 32, 32],
  [64, 64, 64],
  [96, 96, 96],
  [128, 128, 128],
  [160, 160, 160],
  [192, 192, 192],
  [224, 224, 224],
  [255, 255, 255],
  [192, 64, 64],
  [64, 192, 64],
  [64, 64, 192],
  [192, 192, 64],
  [64, 192, 192],
  [192, 64, 192],
];
const GRAY_BARS = 10;

// Read around the center of each bar, away from the edges blurred by the
// chroma subsampling and the compression.
const SAMPLE_HALF_WIDTH = 8;

const CHECK_OUTPUT = {
  width: 1280,
  height: 720,
  frameRate: 30,
  bitRate: 10_000_000,
};
const CHECK_DURATION = 1;
// The time of the frame read back.
const CHECK_TIME = 0.5;

const drawColorBars: FrameDrawer = ({ canvas, width, height }) => {
  'worklet';
  const barWidth = width / COLOR_BARS.length;
  const paint = Skia.Paint();
  COLOR_BARS.forEach(([r, g, b], i) => {
    paint.setColor(Skia.Color(Float32Array.of(r / 255, g / 255, b / 255, 1)));
    canvas.drawRect(
      Skia.XYWHRect(i * barWidth, 0, barWidth + 1, height),
      paint
    );
  });
};

/**
 * Checks the colors of the decoded frames: exports color bars, decodes the
 * exported video (as an export does, the same conversion as the preview) and
 * reads the colors of a frame back. An exported video should keep its colors:
 * the errors are the levels (0-255) a color lost or gained, in an encoding
 * then a decoding, the compression included (a few levels at most).
 */
export const runColorCheck = async (
  abortSignal: AbortSignal,
  onProgress: (progress: number) => void
): Promise<Metrics> => {
  const config = resolveEncoderConfig(CHECK_OUTPUT);
  if (
    config == null ||
    config.width !== CHECK_OUTPUT.width ||
    config.height !== CHECK_OUTPUT.height
  ) {
    throw new Error('No encoder supports 1280x720 on this device');
  }
  const dir = ReactNativeBlobUtil.fs.dirs.CacheDir;
  const barsPath = `${dir}/rnskv-color-bars-${Date.now()}.mp4`;
  const decodedPath = `${dir}/rnskv-color-decoded-${Date.now()}.mp4`;
  try {
    await exportVideoComposition({
      videoComposition: { duration: CHECK_DURATION, items: [] },
      drawFrame: drawColorBars,
      outPath: barsPath,
      abortSignal,
      ...config,
      onProgress: ({ framesCompleted, nbFrames }) =>
        onProgress((framesCompleted / nbFrames) * 0.5),
    });

    const measured: { colors: number[] | null } = { colors: null };
    const record = (colors: number[]) => {
      measured.colors ??= colors;
    };
    const runId = Math.random();
    await exportVideoComposition({
      videoComposition: {
        duration: CHECK_DURATION,
        items: [
          {
            id: 'bars',
            path: barsPath,
            compositionStartTime: 0,
            startTime: 0,
            duration: CHECK_DURATION,
          },
        ],
      },
      drawFrame: ({ frames, currentTime }) => {
        'worklet';
        const frame = frames.bars;
        const state = globalThis as unknown as {
          __rnskvColorCheckRun?: number;
        };
        if (
          frame == null ||
          currentTime < CHECK_TIME ||
          state.__rnskvColorCheckRun === runId
        ) {
          return;
        }
        state.__rnskvColorCheckRun = runId;
        const row = frame.image.readPixels(0, Math.floor(frame.height / 2), {
          width: frame.width,
          height: 1,
          colorType: ColorType.RGBA_8888,
          alphaType: AlphaType.Unpremul,
        });
        if (row == null) {
          return;
        }
        // The mean color around the center of each bar.
        const barWidth = frame.width / COLOR_BARS.length;
        const colors: number[] = [];
        for (let i = 0; i < COLOR_BARS.length; i++) {
          const center = Math.floor((i + 0.5) * barWidth);
          const sums = [0, 0, 0];
          let count = 0;
          for (
            let x = center - SAMPLE_HALF_WIDTH;
            x <= center + SAMPLE_HALF_WIDTH;
            x++
          ) {
            for (let c = 0; c < 3; c++) {
              sums[c]! += row[x * 4 + c]!;
            }
            count++;
          }
          colors.push(...sums.map((sum) => Math.round(sum / count)));
        }
        scheduleOnRN(record, colors);
      },
      outPath: decodedPath,
      abortSignal,
      ...config,
      onProgress: ({ framesCompleted, nbFrames }) =>
        onProgress(0.5 + (framesCompleted / nbFrames) * 0.5),
    });
    // The last scheduleOnRN calls of the export runtime.
    await new Promise((resolve) => setTimeout(resolve, 100));

    const { colors } = measured;
    if (colors == null) {
      throw new Error('Could not read the decoded frame back');
    }
    const errors = COLOR_BARS.map((expected, i) =>
      Math.max(
        ...expected.map((value, c) => Math.abs(colors[i * 3 + c]! - value))
      )
    );
    const max = (values: number[]) => Math.max(...values);
    const describe = (i: number) =>
      `${COLOR_BARS[i]!.join('/')}→${colors.slice(i * 3, i * 3 + 3).join('/')}`;
    return {
      output: `${config.width}x${config.height}@${config.frameRate}`,
      // The largest error over the channels of every bar.
      maxError: max(errors),
      grayMaxError: max(errors.slice(0, GRAY_BARS)),
      colorMaxError: max(errors.slice(GRAY_BARS)),
      // Expected → measured, per bar.
      grays: COLOR_BARS.slice(0, GRAY_BARS)
        .map((_, i) => describe(i))
        .join(' '),
      colors: COLOR_BARS.slice(GRAY_BARS)
        .map((_, i) => describe(GRAY_BARS + i))
        .join(' '),
    };
  } finally {
    for (const path of [barsPath, decodedPath]) {
      await ReactNativeBlobUtil.fs.unlink(path).catch(() => {});
    }
  }
};
