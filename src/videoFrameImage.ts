import type {
  SkCanvas,
  SkImage,
  SkPaint,
  SkRect,
} from '@shopify/react-native-skia';
import { Skia } from '@shopify/react-native-skia';
import type { VideoFrame } from './types';

/**
 * A frame as a Skia image, with what it takes to show its picture: the part of
 * the image that is the picture, and the rotation that shows it upright.
 */
export type VideoFrameImage = {
  /** The frame's whole texture. */
  image: SkImage;
  /**
   * The picture, in the image's pixels: all of the image, except for the
   * decoder's buffers that Android hands over with `textureMode: 'direct'`.
   */
  rect: SkRect;
  /** Clockwise, in degrees (0, 90, 180 or 270), to show the picture upright. */
  rotation: number;
  /** The width of the upright picture. */
  width: number;
  /** The height of the upright picture. */
  height: number;
};

/**
 * How the picture fills the destination of {@link drawVideoFrame}.
 *
 * - `fill`: all of it, stretched to the destination.
 * - `cover`: the middle of it with the destination's aspect, all of the
 *   destination.
 * - `contain`: all of it with its own aspect, in the middle of the destination.
 */
export type VideoFrameFit = 'fill' | 'cover' | 'contain';

/**
 * Wraps a frame's texture in a Skia image, and says which part of it to draw
 * and how to turn it. Works with every frame, whatever the platform and the
 * texture mode: iOS frames and Android `direct` frames come as decoded, with
 * a rotation, and Android `direct` frames are larger than their picture.
 *
 * @param frame the frame, drawn in the tick it was handed out in
 * @param output an image returned for a previous frame, recycled rather than
 * allocating a new wrapper, see `MakeImageFromNativeTextureUnstable`
 * @returns the image and its picture, or null when the frame has no texture
 */
export const makeVideoFrameImage = (
  frame: VideoFrame,
  output?: SkImage | null
): VideoFrameImage | null => {
  'worklet';
  if (frame.texture == null) {
    return null;
  }
  const image = Skia.Image.MakeImageFromNativeTextureUnstable(
    frame.texture,
    frame.width,
    frame.height,
    false,
    output ?? undefined
  );
  if (!image) {
    return null;
  }
  const crop = frame.crop ?? {
    x: 0,
    y: 0,
    width: frame.width,
    height: frame.height,
  };
  const rotation = (((Math.round(frame.rotation / 90) * 90) % 360) + 360) % 360;
  const quarter = rotation === 90 || rotation === 270;
  return {
    image,
    rect: { x: crop.x, y: crop.y, width: crop.width, height: crop.height },
    rotation,
    width: quarter ? crop.height : crop.width,
    height: quarter ? crop.width : crop.height,
  };
};

/**
 * The part of the texture that shows a rectangle of the upright picture.
 */
const textureRectOf = (
  rect: SkRect,
  rotation: number,
  upright: SkRect
): SkRect => {
  'worklet';
  const u0 = upright.x;
  const u1 = upright.x + upright.width;
  const v0 = upright.y;
  const v1 = upright.y + upright.height;
  switch (rotation) {
    case 90:
      // Turned clockwise: the texture's left edge is the picture's top.
      return {
        x: rect.x + v0,
        y: rect.y + rect.height - u1,
        width: v1 - v0,
        height: u1 - u0,
      };
    case 180:
      return {
        x: rect.x + rect.width - u1,
        y: rect.y + rect.height - v1,
        width: u1 - u0,
        height: v1 - v0,
      };
    case 270:
      return {
        x: rect.x + rect.width - v1,
        y: rect.y + u0,
        width: v1 - v0,
        height: u1 - u0,
      };
    default:
      return {
        x: rect.x + u0,
        y: rect.y + v0,
        width: u1 - u0,
        height: v1 - v0,
      };
  }
};

/**
 * Draws a frame's picture, upright, into a rectangle of the canvas.
 *
 * @param canvas the canvas to draw on
 * @param frame the frame, drawn in the tick it was handed out in
 * @param dst where to draw the picture
 * @param options.paint the paint to draw with, for an opacity say
 * @param options.fit how the picture fills `dst`, `fill` by default
 * @param options.output an image returned by a previous call, recycled
 * @returns the image drawn, to pass back as `output` next time, or null when
 * the frame has no texture
 */
export const drawVideoFrame = (
  canvas: SkCanvas,
  frame: VideoFrame,
  dst: SkRect,
  options?: {
    paint?: SkPaint;
    fit?: VideoFrameFit;
    output?: SkImage | null;
  }
): SkImage | null => {
  'worklet';
  const frameImage = makeVideoFrameImage(frame, options?.output);
  if (!frameImage) {
    return null;
  }
  const { image, rect, rotation, width, height } = frameImage;
  const fit = options?.fit ?? 'fill';
  // What of the upright picture is drawn, and where.
  let picture: SkRect = { x: 0, y: 0, width, height };
  let target: SkRect = dst;
  if (fit === 'cover') {
    const scale = Math.max(dst.width / width, dst.height / height);
    const visibleWidth = dst.width / scale;
    const visibleHeight = dst.height / scale;
    picture = {
      x: (width - visibleWidth) / 2,
      y: (height - visibleHeight) / 2,
      width: visibleWidth,
      height: visibleHeight,
    };
  } else if (fit === 'contain') {
    const scale = Math.min(dst.width / width, dst.height / height);
    target = {
      x: dst.x + (dst.width - width * scale) / 2,
      y: dst.y + (dst.height - height * scale) / 2,
      width: width * scale,
      height: height * scale,
    };
  }
  const src = textureRectOf(rect, rotation, picture);
  const paint = options?.paint ?? Skia.Paint();
  if (rotation === 0) {
    canvas.drawImageRect(image, src, target, paint);
    return image;
  }
  // Turned about the target's centre, into the target's turned extent.
  const quarter = rotation === 90 || rotation === 270;
  const turnedWidth = quarter ? target.height : target.width;
  const turnedHeight = quarter ? target.width : target.height;
  canvas.save();
  canvas.translate(target.x + target.width / 2, target.y + target.height / 2);
  canvas.rotate(rotation, 0, 0);
  canvas.drawImageRect(
    image,
    src,
    {
      x: -turnedWidth / 2,
      y: -turnedHeight / 2,
      width: turnedWidth,
      height: turnedHeight,
    },
    paint
  );
  canvas.restore();
  return image;
};
