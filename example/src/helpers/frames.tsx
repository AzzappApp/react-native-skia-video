import { useDerivedValue, type SharedValue } from 'react-native-reanimated';
import {
  Canvas,
  ClipOp,
  Fill,
  Group,
  Image,
  Skia,
  type SkCanvas,
} from 'react-native-skia';
import type { VideoFrame } from '@azzapp/react-native-skia-video';
import { colors } from '../theme';

/**
 * Drawing video frames upright. On iOS a frame is the image as stored in the
 * file, with the rotation to apply to it (a portrait phone clip is a
 * 1920×1080 image to rotate by 90°); on Android it is already upright
 * (rotation 0). See `VideoFrame.rotation`.
 */

type Size = { width: number; height: number };

/** The size of a frame (or of a video, see onReadyToPlay) once upright. */
export const uprightSize = ({
  width,
  height,
  rotation,
}: Size & { rotation: number }): Size => {
  'worklet';
  return rotation === 90 || rotation === 270
    ? { width: height, height: width }
    : { width, height };
};

/**
 * The scale and translation that fit an image of `imageSize` (as stored,
 * before its rotation) into `size`, upright and centered: it covers `size`,
 * or is contained in it.
 */
const fitTransform = (
  imageSize: Size,
  rotation: number,
  size: Size,
  fit: 'cover' | 'contain'
) => {
  'worklet';
  const upright = uprightSize({ ...imageSize, rotation });
  const scaleX = size.width / upright.width;
  const scaleY = size.height / upright.height;
  return {
    scale:
      fit === 'cover' ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY),
    centerX: size.width / 2,
    centerY: size.height / 2,
  };
};

/**
 * Draws `frame` upright into the `width` × `height` rect at the origin of
 * `canvas`, covering it or contained in it: for a composition's drawFrame.
 */
export const drawFrameFitted = (
  canvas: SkCanvas,
  frame: VideoFrame,
  width: number,
  height: number,
  fit: 'cover' | 'contain' = 'cover'
) => {
  'worklet';
  const { image, rotation } = frame;
  const imageSize = { width: image.width(), height: image.height() };
  const { scale, centerX, centerY } = fitTransform(
    imageSize,
    rotation,
    { width, height },
    fit
  );
  canvas.save();
  canvas.clipRect({ x: 0, y: 0, width, height }, ClipOp.Intersect, true);
  canvas.translate(centerX, centerY);
  canvas.rotate(rotation, 0, 0);
  canvas.scale(scale, scale);
  canvas.drawImageRect(
    image,
    { x: 0, y: 0, ...imageSize },
    {
      x: -imageSize.width / 2,
      y: -imageSize.height / 2,
      ...imageSize,
    },
    Skia.Paint()
  );
  canvas.restore();
};

/**
 * A canvas showing the frames of a video player (useVideoPlayer), upright
 * and contained in it, on the app's background.
 */
export const VideoFrameCanvas = ({
  frame,
  width,
  height,
}: {
  frame: SharedValue<VideoFrame | null>;
  width: number;
  height: number;
}) => {
  const image = useDerivedValue(() => frame.value?.image ?? null);
  const imageWidth = useDerivedValue(() => frame.value?.image.width() ?? 0);
  const imageHeight = useDerivedValue(() => frame.value?.image.height() ?? 0);
  const transform = useDerivedValue(() => {
    const current = frame.value;
    if (current == null) {
      return [];
    }
    const { scale, centerX, centerY } = fitTransform(
      { width: current.image.width(), height: current.image.height() },
      current.rotation,
      { width, height },
      'contain'
    );
    return [
      { translateX: centerX },
      { translateY: centerY },
      { rotate: (current.rotation * Math.PI) / 180 },
      { scale },
    ];
  });
  const x = useDerivedValue(() => -imageWidth.value / 2);
  const y = useDerivedValue(() => -imageHeight.value / 2);
  return (
    <Canvas style={{ width, height }} android={{ backingView: 'SurfaceView' }}>
      <Fill color={colors.background} />
      <Group transform={transform}>
        <Image
          image={image}
          x={x}
          y={y}
          width={imageWidth}
          height={imageHeight}
        />
      </Group>
    </Canvas>
  );
};
