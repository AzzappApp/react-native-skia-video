import type { SkCanvas, SkImage, SkPaint, SkRect } from '@shopify/react-native-skia';
import type { VideoFrame } from './types.js';
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
export declare const makeVideoFrameImage: (frame: VideoFrame, output?: SkImage | null) => VideoFrameImage | null;
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
export declare const drawVideoFrame: (canvas: SkCanvas, frame: VideoFrame, dst: SkRect, options?: {
    paint?: SkPaint;
    fit?: VideoFrameFit;
    output?: SkImage | null;
}) => SkImage | null;
//# sourceMappingURL=videoFrameImage.d.ts.map