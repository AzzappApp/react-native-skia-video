/// <reference types="@webgpu/types" />
import type { SkImage } from 'react-native-skia';
import { GPUTextureUsage } from 'react-native-webgpu';
import {
  releaseImportedBuffer,
  type ImportedBuffers,
  type ImportedBuffer,
} from './importedBuffers';

/**
 * What is kept for the frames of one key (a player, a composition item, see
 * createFrameImagesKey): the RGBA texture they are converted into, and the
 * Skia images of that texture.
 */
export type FrameSlot = {
  /** Skia's device, the frames are converted with. */
  device: GPUDevice;
  /** The texture the frames are converted into, made with the first one. */
  texture: GPUTexture | null;
  /** The image of the texture handed out with the current frame. */
  image: SkImage | null;
  /**
   * The other image of the texture, handed out with the next frame: see
   * makeVideoFrame for why two.
   */
  spareImage: SkImage | null;
  /** The id of the frame in the texture (see DecodedFrame.id). */
  frameId: number | undefined;
  /** The uniforms of the conversion pass (see gpuConversion.ts). */
  uniformBuffer?: GPUBuffer;
  /** Android: the decoder buffers imported into Skia's device. */
  importedBuffers?: ImportedBuffers;
};

type FrameSlots = Record<string, FrameSlot>;

/**
 * Returns the slots of the runtime: they live on the runtime that draws the
 * frames (the UI runtime, or the export runtime), on its global object rather
 * than captured by the worklets, so that they can be updated in place.
 */
export const getFrameSlots = (): FrameSlots => {
  'worklet';
  const global = globalThis as unknown as { __rnskvFrameSlots?: FrameSlots };
  if (global.__rnskvFrameSlots == null) {
    global.__rnskvFrameSlots = {};
  }
  return global.__rnskvFrameSlots;
};

/**
 * Returns the texture of `slot`, made again if it doesn't have the given
 * size (its images go with it).
 */
export const getSlotTexture = (
  device: GPUDevice,
  slot: FrameSlot,
  width: number,
  height: number
): GPUTexture => {
  'worklet';
  if (
    slot.texture == null ||
    slot.texture.width !== width ||
    slot.texture.height !== height
  ) {
    slot.image?.dispose();
    slot.image = null;
    slot.spareImage?.dispose();
    slot.spareImage = null;
    slot.texture?.destroy();
    slot.texture = device.createTexture({
      size: [width, height],
      format: 'rgba8unorm',
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT |
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST,
    });
  }
  return slot.texture;
};

/**
 * Android: how many imported buffers of released slots are released per
 * frame, when spread over frames (see releaseSlots). The 20 or so buffers of
 * a clip, released at once, took 40 to 70 ms on a Qualcomm device: 2 to 3
 * frames missed by the display at each clip change of a sequence.
 */
const BUFFER_RELEASES_PER_FRAME = 2;

type PendingBufferRelease = {
  slotKey: string;
  device: GPUDevice;
  buffer: ImportedBuffer;
};

// The imported buffers of released slots, not released yet (see
// releaseSlots). On the runtime's global object, like the slots.
const getPendingBufferReleases = (): PendingBufferRelease[] => {
  'worklet';
  const global = globalThis as unknown as {
    __rnskvPendingBufferReleases?: PendingBufferRelease[];
  };
  if (global.__rnskvPendingBufferReleases == null) {
    global.__rnskvPendingBufferReleases = [];
  }
  return global.__rnskvPendingBufferReleases;
};

/**
 * Releases the slots whose key `shouldRelease` returns true for: their
 * texture, images and uniforms now, their imported buffers (Android) now
 * too, or, with `spreadBufferReleases`, `BUFFER_RELEASES_PER_FRAME` at a time
 * with this call and the next ones (one per frame). The buffers left by
 * earlier calls go first.
 */
export const releaseSlots = (
  shouldRelease: (slotKey: string) => boolean,
  spreadBufferReleases = false
) => {
  'worklet';
  const slots = getFrameSlots();
  const pending = getPendingBufferReleases();
  for (const slotKey of Object.keys(slots)) {
    if (!shouldRelease(slotKey)) {
      continue;
    }
    const slot = slots[slotKey]!;
    slot.image?.dispose();
    slot.spareImage?.dispose();
    slot.texture?.destroy();
    slot.uniformBuffer?.destroy();
    for (const buffer of slot.importedBuffers?.buffers ?? []) {
      pending.push({ slotKey, device: slot.device, buffer });
    }
    delete slots[slotKey];
  }

  let released = 0;
  let device: GPUDevice | null = null;
  for (let i = 0; i < pending.length;) {
    const release = pending[i]!;
    const now = spreadBufferReleases
      ? released < BUFFER_RELEASES_PER_FRAME
      : shouldRelease(release.slotKey);
    if (now) {
      releaseImportedBuffer(release.buffer);
      device = release.device;
      pending.splice(i, 1);
      released++;
    } else {
      i++;
    }
  }
  if (device != null) {
    // Dawn frees the memory of released buffers once the GPU is done with a
    // submission made after their release, and nothing is submitted once the
    // frames stop (an export done, a player released): the buffers would be
    // kept until the next video. Submits one now, and has the device ticked
    // until it is done.
    device.queue.submit([]);
    device.queue.onSubmittedWorkDone().catch(() => {});
  }
};
