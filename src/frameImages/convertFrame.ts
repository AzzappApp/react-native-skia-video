/// <reference types="@webgpu/types" />
import type { DecodedFrame } from '../types';
import type { FrameImageContext } from './context';
import { getSlotTexture, type FrameSlot } from './frameSlots';
import {
  VIDEO_COLOR_SPACE,
  drawFrameInto,
  getUniformBuffer,
  makeConversionBindGroup,
} from './gpuConversion';
import {
  forgetImportedBuffer,
  getImportedBuffer,
  type ImportedBuffers,
} from './importedBuffers';

/**
 * Converts a decoded frame into the RGBA texture of its slot, on Skia's
 * queue, with the conversion pass of gpuConversion.ts. One function per
 * platform, as the decoders hand their frames over differently.
 */

/**
 * iOS: the frame is a `CVPixelBuffer` of its decoder, in NV12, imported as an
 * external texture (React Native WebGPU's importExternalTexture) and drawn
 * whole. The decoders' pools hand out fresh buffers: each frame is imported.
 *
 * The frame is released once converted, which hands its buffer back to the
 * decoder now rather than when its JS wrapper is garbage collected. Not when
 * the conversion failed: the producer hands the same frame out again until a
 * new one is decoded, and it is converted again (a paused player would
 * otherwise never show it).
 */
export const convertFrameIOS = (
  { device, webgpu }: FrameImageContext,
  slot: FrameSlot,
  frame: DecodedFrame,
  buffer: bigint
): GPUTexture => {
  'worklet';
  const nativeFrame = webgpu.createVideoFrameFromNativeBuffer(buffer);
  let externalTexture: GPUExternalTexture | null = null;
  let texture: GPUTexture;
  try {
    texture = getSlotTexture(
      device,
      slot,
      nativeFrame.width,
      nativeFrame.height
    );
    externalTexture = device.importExternalTexture({
      source: nativeFrame,
      sourceColorSpace: VIDEO_COLOR_SPACE,
    });
    const uniformBuffer = getUniformBuffer(device, slot);
    // The whole frame: uvScale 1, uvOffset 0.
    device.queue.writeBuffer(uniformBuffer, 0, new Float32Array([1, 1, 0, 0]));
    drawFrameInto(
      device,
      makeConversionBindGroup(device, externalTexture, uniformBuffer),
      texture
    );
  } finally {
    // Once the commands sampling the frame are submitted, never before.
    externalTexture?.destroy();
    nativeFrame.release();
  }
  frame.release?.();
  return texture;
};

type YUVLayout = NonNullable<DecodedFrame['yuv']>;

/**
 * Android: the region `layout` of a buffer of `bufferWidth` × `bufferHeight`
 * in the upright frame, once the buffer is rotated clockwise by
 * `layout.rotation`: the coordinates React Native WebGPU samples external
 * textures in.
 */
export const uprightCrop = (
  layout: YUVLayout,
  bufferWidth: number,
  bufferHeight: number
) => {
  'worklet';
  const { x, y, width, height } = layout;
  switch (layout.rotation) {
    case 90:
      return {
        x: bufferHeight - y - height,
        y: x,
        width: height,
        height: width,
      };
    case 180:
      return {
        x: bufferWidth - x - width,
        y: bufferHeight - y - height,
        width,
        height,
      };
    case 270:
      return { x: y, y: bufferWidth - x - width, width: height, height: width };
    default:
      return { x, y, width, height };
  }
};

/**
 * Android: the frame is a buffer of its decoder, in the decoder's own YUV
 * layout, padded: the region `frame.yuv` of the buffer holds the picture, to
 * rotate by `frame.yuv.rotation` and scale to the frame's size. The buffer is
 * imported once and kept (see importedBuffers.ts); the frame only accesses it.
 *
 * The fence signaled once the pass is done reading the buffer is not handed
 * back to the decoder: the decoder keeps the buffer a couple of frames before
 * rendering into it again instead (see ImageReaderFrameExtractor). The frame
 * is released either way: it is handed out again, with a reference to its
 * buffer of its own, until a new one is decoded.
 */
export const convertFrameAndroid = (
  { device, webgpu }: FrameImageContext,
  slot: FrameSlot,
  frame: DecodedFrame,
  buffer: bigint
): GPUTexture => {
  'worklet';
  try {
    const layout = frame.yuv;
    if (layout == null) {
      throw new Error('The video frame has no YUV layout');
    }
    const uniformBuffer = getUniformBuffer(device, slot);
    const imported: ImportedBuffers = (slot.importedBuffers ??= {
      buffers: [],
      frameIndex: 0,
    });
    const importedBuffer = getImportedBuffer(
      device,
      webgpu,
      imported,
      buffer,
      layout.rotation,
      uniformBuffer
    );
    try {
      importedBuffer.wrapper.beginAccess();
    } catch (error) {
      // Imported again with the next frame.
      forgetImportedBuffer(imported, importedBuffer);
      throw error;
    }
    try {
      const texture = getSlotTexture(device, slot, frame.width, frame.height);
      // The region of the upright buffer to draw, as uvScale and uvOffset.
      const { width, height } = importedBuffer;
      const swapped = layout.rotation === 90 || layout.rotation === 270;
      const uprightWidth = swapped ? height : width;
      const uprightHeight = swapped ? width : height;
      const crop = uprightCrop(layout, width, height);
      device.queue.writeBuffer(
        uniformBuffer,
        0,
        new Float32Array([
          crop.width / uprightWidth,
          crop.height / uprightHeight,
          crop.x / uprightWidth,
          crop.y / uprightHeight,
        ])
      );
      drawFrameInto(device, importedBuffer.bindGroup, texture);
      return texture;
    } finally {
      // Once the commands sampling the buffer are submitted, never before.
      importedBuffer.wrapper.endAccess()?.fence.destroy();
    }
  } finally {
    frame.release?.();
  }
};
