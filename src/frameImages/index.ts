/// <reference types="@webgpu/types" />
import { Skia } from 'react-native-skia';
import type { DecodedFrame, VideoFrame } from '../types';
import { IS_ANDROID, type FrameImageContext } from './context';
import { convertFrameAndroid, convertFrameIOS } from './convertFrame';
import { getFrameSlots, releaseSlots } from './frameSlots';

/**
 * Turns the frames the native decoders hand out into Skia images.
 *
 * A decoded frame (DecodedFrame) is a buffer of its decoder, in YUV: an NV12
 * `CVPixelBuffer` on iOS, an `AHardwareBuffer` in the decoder's own layout on
 * Android. Skia can't draw it as is. Each frame is converted on the GPU, on
 * Skia's device, into an RGBA texture, and Skia wraps that texture into an
 * image, without copy:
 *
 * - `makeVideoFrame` converts the frame of a key (a player, see
 *   createFrameImagesKey) into the texture of the key's slot (frameSlots.ts),
 *   with the conversion pass of gpuConversion.ts, set up per platform by
 *   convertFrame.ts. On Android, the decoder buffers are imported into Skia's
 *   device once and kept (importedBuffers.ts).
 * - `makeVideoFrames` does it for the items of a composition, and releases the
 *   slots of the items that no longer have a frame.
 * - `releaseFrameImages` releases the slots of a key, when its player is
 *   released.
 *
 * All of them are worklets, called on the runtime that draws the frames (the
 * UI runtime, or the export runtime), where the slots live. Worklets capture
 * the functions they call when they are created, so a module defines a
 * function before the ones calling it, and the modules don't import each
 * other in a cycle.
 */

export {
  createFrameImagesKey,
  getFrameImageContext,
  type FrameImageContext,
} from './context';
export { uprightCrop } from './convertFrame';

/**
 * Turns a decoded frame into a `VideoFrame` whose image Skia can draw.
 *
 * The images of a key show its latest frame: a frame is only valid until the
 * next frame of the same key is made.
 */
export const makeVideoFrame = (
  context: FrameImageContext,
  key: string,
  frame: DecodedFrame
): VideoFrame => {
  'worklet';
  const slots = getFrameSlots();
  const slot = (slots[key] ??= {
    device: context.device,
    texture: null,
    image: null,
    spareImage: null,
    frameId: undefined,
  });
  const { buffer, id: frameId } = frame;

  // A producer hands out its current frame again until a new one is decoded:
  // without its buffer once released (iOS), or with the same id (Android).
  // It is already in the texture.
  if (
    slot.image != null &&
    (buffer == null || (frameId != null && frameId === slot.frameId))
  ) {
    frame.release?.();
    return {
      image: slot.image,
      texture: slot.texture!,
      width: frame.width,
      height: frame.height,
      rotation: frame.rotation,
    };
  }
  if (buffer == null) {
    throw new Error('The video frame was released before being drawn');
  }

  const texture = IS_ANDROID
    ? convertFrameAndroid(context, slot, frame, buffer)
    : convertFrameIOS(context, slot, frame, buffer);

  // Two images of the texture, handed out in turn. A new frame needs another
  // image object: Reanimated ignores setting a shared value to the object it
  // already holds (e.g. `useDerivedValue(() => currentFrame.value?.image)`).
  // And a new image per frame would charge the texture's size to the garbage
  // collector every frame.
  const image = slot.spareImage ?? Skia.Image.MakeImageFromGPUTexture(texture);
  slot.spareImage = slot.image;
  slot.image = image;
  slot.frameId = frameId;
  return {
    image,
    texture,
    width: frame.width,
    height: frame.height,
    rotation: frame.rotation,
  };
};

/**
 * `makeVideoFrame` for the items of a composition, keyed by item id (their
 * slots are `${key}:${itemId}`).
 *
 * A composition only hands out the frames of the items around its current
 * time (see isLiveAt in the native code): the slots of the items without a
 * frame are released, rather than kept for the whole composition (a 1080p
 * texture is 8 MB, a 4K one 33 MB, and the buffers imported with them pin
 * their decoder's). Their imported buffers are released a few per frame (see
 * releaseSlots).
 *
 * With `onError`, the frame of an item that can't be made is left out and
 * reported, and the frames of the other items are still made. Otherwise the
 * error is thrown.
 */
export const makeVideoFrames = (
  context: FrameImageContext,
  key: string,
  frames: Record<string, DecodedFrame>,
  onError?: (itemId: string, error: unknown) => void
): Record<string, VideoFrame> => {
  'worklet';
  const prefix = `${key}:`;
  releaseSlots(
    (slotKey) =>
      slotKey.startsWith(prefix) &&
      frames[slotKey.slice(prefix.length)] == null,
    true
  );
  const result: Record<string, VideoFrame> = {};
  for (const itemId of Object.keys(frames)) {
    try {
      result[itemId] = makeVideoFrame(
        context,
        prefix + itemId,
        frames[itemId]!
      );
    } catch (error) {
      if (onError == null) {
        throw error;
      }
      onError(itemId, error);
    }
  }
  return result;
};

/**
 * Releases the slots of `key`, and of its items (`${key}:${itemId}`): their
 * textures, images and imported buffers.
 *
 * Must be called on the runtime that drew the frames.
 */
export const releaseFrameImages = (key: string) => {
  'worklet';
  releaseSlots((slotKey) => slotKey === key || slotKey.startsWith(`${key}:`));
};
