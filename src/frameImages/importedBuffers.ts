/// <reference types="@webgpu/types" />
import type {
  GPUNativeBufferExternalTexture,
  NativeVideoFrame,
} from 'react-native-webgpu';
import type { FrameImageContext } from './context';
import { VIDEO_COLOR_SPACE, makeConversionBindGroup } from './gpuConversion';

/**
 * Android: the decoder buffers a key's frames come in, imported into Skia's
 * device.
 *
 * A decoder renders its frames into the same few buffers in turn. Importing a
 * buffer (as an external texture, with React Native WebGPU's
 * createNativeBufferExternalTexture) cost about 8 ms per 1080p frame on a
 * Qualcomm device, so each one is imported once and kept: a frame only begins
 * and ends an access to it (see convertFrameAndroid).
 */

/** A decoder buffer imported into Skia's device. */
export type ImportedBuffer = {
  /** The buffer (`AHardwareBuffer*`). */
  handle: bigint;
  /** The import, and its external texture. */
  wrapper: GPUNativeBufferExternalTexture;
  /** The frame the wrapper was made from: it holds the buffer. */
  nativeFrame: NativeVideoFrame;
  /** The size of the buffer, its padding included. */
  width: number;
  height: number;
  /** The rotation the external texture applies. */
  rotation: number;
  /** The bind group of the conversion pass sampling the buffer. */
  bindGroup: GPUBindGroup;
  /** The last frame (see ImportedBuffers.frameIndex) that used the buffer. */
  lastUse: number;
};

/** The buffers imported for a key, with the count of its frames. */
export type ImportedBuffers = {
  buffers: ImportedBuffer[];
  frameIndex: number;
};

/**
 * The most buffers kept per key. A decoder renders into every buffer it
 * decodes ahead into, and its frames are kept a few more frames (see
 * ImageReaderFrameExtractor): about 20 buffers in turn on a Qualcomm device.
 * Fewer would import every frame's buffer again.
 */
const MAX_BUFFERS = 32;

/**
 * The frames after which a buffer no frame used is released: its decoder no
 * longer renders into it.
 */
const MAX_UNUSED_FRAMES = 2 * MAX_BUFFERS;

/** Releases an imported buffer. */
export const releaseImportedBuffer = (buffer: ImportedBuffer) => {
  'worklet';
  buffer.wrapper.externalTexture.destroy();
  buffer.wrapper.destroy();
  // The wrapper only drops its reference to the frame: the frame's own keeps
  // the buffer (and its decoder's memory) until it is garbage collected.
  buffer.nativeFrame.release();
};

/** Releases `buffer` and removes it from `imported`. */
export const forgetImportedBuffer = (
  imported: ImportedBuffers,
  buffer: ImportedBuffer
) => {
  'worklet';
  releaseImportedBuffer(buffer);
  imported.buffers.splice(imported.buffers.indexOf(buffer), 1);
};

/**
 * Returns the buffer `handle` imported as an external texture rotated by
 * `rotation`: the one imported by an earlier frame, or imported now, its
 * conversion pass sampled with the uniforms of `uniformBuffer`. Counts a
 * frame of the key, and releases the buffers no frame used for
 * `MAX_UNUSED_FRAMES` frames, and the least recently used one past
 * `MAX_BUFFERS`.
 */
export const getImportedBuffer = (
  device: GPUDevice,
  webgpu: FrameImageContext['webgpu'],
  imported: ImportedBuffers,
  handle: bigint,
  rotation: number,
  uniformBuffer: GPUBuffer
): ImportedBuffer => {
  'worklet';
  const { buffers } = imported;
  const frameIndex = ++imported.frameIndex;

  const existing = buffers.find((candidate) => candidate.handle === handle);
  if (existing != null) {
    if (existing.rotation === rotation) {
      existing.lastUse = frameIndex;
      return existing;
    }
    // The same buffer for a video of another rotation: imported again.
    forgetImportedBuffer(imported, existing);
  }

  for (let i = buffers.length - 1; i >= 0; i--) {
    if (frameIndex - buffers[i]!.lastUse > MAX_UNUSED_FRAMES) {
      releaseImportedBuffer(buffers[i]!);
      buffers.splice(i, 1);
    }
  }
  if (buffers.length >= MAX_BUFFERS) {
    let oldest = buffers[0]!;
    for (const buffer of buffers) {
      if (buffer.lastUse < oldest.lastUse) {
        oldest = buffer;
      }
    }
    forgetImportedBuffer(imported, oldest);
  }

  // The wrapper holds the frame, and so the buffer, until it is destroyed:
  // the handle can't be reused by another buffer while it is kept here.
  const nativeFrame = webgpu.createVideoFrameFromNativeBuffer(handle);
  let wrapper: GPUNativeBufferExternalTexture;
  try {
    wrapper = device.createNativeBufferExternalTexture(nativeFrame, {
      rotation: rotation as 0 | 90 | 180 | 270,
      sourceColorSpace: VIDEO_COLOR_SPACE,
    });
  } catch (error) {
    nativeFrame.release();
    throw error;
  }
  const buffer: ImportedBuffer = {
    handle,
    wrapper,
    nativeFrame,
    width: nativeFrame.width,
    height: nativeFrame.height,
    rotation,
    bindGroup: makeConversionBindGroup(
      device,
      wrapper.externalTexture,
      uniformBuffer
    ),
    lastUse: frameIndex,
  };
  buffers.push(buffer);
  return buffer;
};
