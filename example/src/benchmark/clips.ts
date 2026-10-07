import { Platform } from 'react-native';
import ReactNativeBlobUtil from 'react-native-blob-util';
import { Skia, TileMode } from 'react-native-skia';
import {
  exportVideoComposition,
  getValidEncoderConfigurations,
  type FrameDrawer,
  type VideoComposition,
} from '@azzapp/react-native-skia-video';

/**
 * The test clips of the benchmark. They are generated on the device (by
 * exporting a synthetic animation with the library itself) so that every run
 * decodes the exact same files, without network or assets in the repository.
 */
export type ClipSpec = {
  id: string;
  width: number;
  height: number;
  frameRate: number;
  bitRate: number;
  duration: number;
};

export const CLIPS: ClipSpec[] = [
  {
    id: '1080p30',
    width: 1920,
    height: 1080,
    frameRate: 30,
    bitRate: 10_000_000,
    duration: 12,
  },
  {
    id: '1080p60',
    width: 1920,
    height: 1080,
    frameRate: 60,
    bitRate: 16_000_000,
    duration: 12,
  },
  {
    id: '2160p30',
    width: 3840,
    height: 2160,
    frameRate: 30,
    bitRate: 40_000_000,
    duration: 12,
  },
];

// Bump to regenerate the clips when their content changes.
const CLIPS_VERSION = 1;

const clipsDir = () =>
  `${ReactNativeBlobUtil.fs.dirs.DocumentDir}/rnskv-benchmark`;

export const getClip = (id: string) => {
  const clip = CLIPS.find((candidate) => candidate.id === id);
  if (clip == null) {
    throw new Error(`Unknown clip ${id}`);
  }
  return clip;
};

export const getClipPath = (clip: ClipSpec) =>
  `${clipsDir()}/v${CLIPS_VERSION}-${clip.id}.mp4`;

export const isClipReady = (clip: ClipSpec) =>
  ReactNativeBlobUtil.fs.exists(getClipPath(clip));

export type EncoderConfig = {
  width: number;
  height: number;
  frameRate: number;
  bitRate: number;
  encoderName?: string | null;
};

/**
 * The encoder configuration closest to the requested one (Android encoders
 * have limits), or null if no encoder supports it.
 */
export const resolveEncoderConfig = (
  requested: EncoderConfig
): EncoderConfig | null => {
  if (Platform.OS !== 'android') {
    return requested;
  }
  const configs = getValidEncoderConfigurations(
    requested.width,
    requested.height,
    requested.frameRate,
    requested.bitRate
  );
  return configs?.[0] ?? null;
};

/**
 * Generates the clip (once): a 12 s animation with motion over the whole
 * frame and fine details, so that decoding it costs as much as a real video.
 */
export const generateClip = async (
  clip: ClipSpec,
  abortSignal: AbortSignal,
  onProgress: (progress: number) => void
) => {
  const config = resolveEncoderConfig(clip);
  if (config == null) {
    throw new Error(`No encoder supports ${clip.id} on this device`);
  }
  await ReactNativeBlobUtil.fs.mkdir(clipsDir()).catch(() => {});
  const path = getClipPath(clip);
  const tmpPath = `${path}.tmp.mp4`;
  if (await ReactNativeBlobUtil.fs.exists(tmpPath)) {
    await ReactNativeBlobUtil.fs.unlink(tmpPath);
  }
  await exportVideoComposition({
    videoComposition: { duration: clip.duration, items: [] },
    drawFrame: drawTestPattern,
    outPath: tmpPath,
    abortSignal,
    ...config,
    onProgress: ({ framesCompleted, nbFrames }) =>
      onProgress(framesCompleted / nbFrames),
  });
  await ReactNativeBlobUtil.fs.mv(tmpPath, path);
};

const hueColor = (hue: number) => {
  'worklet';
  // HSL with full saturation and 50% lightness.
  const channel = (n: number) => {
    const k = (n + hue * 12) % 12;
    return 0.5 - 0.5 * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return Skia.Color(Float32Array.of(channel(0), channel(8), channel(4), 1));
};

/**
 * A synthetic animation: a moving gradient, circles moving over the whole
 * frame and a scrolling checkerboard (fine details, costly to encode).
 */
export const drawTestPattern: FrameDrawer<any> = ({
  canvas,
  currentTime: t,
  width,
  height,
}) => {
  'worklet';
  const background = Skia.Paint();
  background.setShader(
    Skia.Shader.MakeLinearGradient(
      { x: 0, y: 0 },
      { x: width, y: height },
      [hueColor(t * 0.1), hueColor(t * 0.1 + 0.5)],
      null,
      TileMode.Clamp
    )
  );
  canvas.drawPaint(background);

  const paint = Skia.Paint();
  const circles = 48;
  const radius = Math.min(width, height) / 14;
  for (let i = 0; i < circles; i++) {
    paint.setColor(hueColor(i / circles + t * 0.15));
    canvas.drawCircle(
      width / 2 + Math.sin(t * (0.7 + i * 0.05) + i) * width * 0.45,
      height / 2 + Math.cos(t * (0.9 + i * 0.03) + i * 1.3) * height * 0.45,
      radius,
      paint
    );
  }

  const cell = Math.max(8, Math.round(width / 96));
  const offset = Math.floor(t * 30);
  const white = Skia.Color('white');
  const black = Skia.Color('black');
  for (let row = 0; row < 4; row++) {
    for (let column = 0; column * cell < width; column++) {
      paint.setColor((column + row + offset) % 2 === 0 ? white : black);
      canvas.drawRect(
        {
          x: column * cell,
          y: height - (row + 1) * cell,
          width: cell,
          height: cell,
        },
        paint
      );
    }
  }
};

/**
 * Draws the frames of the composition items side by side (each one cropped
 * to fill its column).
 */
export const drawItemsGrid: FrameDrawer<any> = ({
  canvas,
  videoComposition,
  frames,
  width,
  height,
}) => {
  'worklet';
  canvas.drawColor(Skia.Color('black'));
  const { items } = videoComposition;
  const columnWidth = width / items.length;
  const columnAspectRatio = columnWidth / height;
  const paint = Skia.Paint();
  for (let i = 0; i < items.length; i++) {
    const frame = frames[items[i]!.id];
    if (!frame) {
      continue;
    }
    const frameAspectRatio = frame.width / frame.height;
    const source =
      frameAspectRatio > columnAspectRatio
        ? {
            x: (frame.width - frame.height * columnAspectRatio) / 2,
            y: 0,
            width: frame.height * columnAspectRatio,
            height: frame.height,
          }
        : {
            x: 0,
            y: (frame.height - frame.width / columnAspectRatio) / 2,
            width: frame.width,
            height: frame.width / columnAspectRatio,
          };
    canvas.drawImageRect(
      frame.image,
      source,
      { x: i * columnWidth, y: 0, width: columnWidth, height },
      paint
    );
  }
};

/**
 * A composition playing the clips at the same time, from their start.
 */
export const buildComposition = (
  clipIds: string[],
  duration: number
): VideoComposition => ({
  duration,
  items: clipIds.map((clipId, index) => ({
    id: `item-${index}`,
    path: getClipPath(getClip(clipId)),
    compositionStartTime: 0,
    startTime: 0,
    duration,
  })),
});
