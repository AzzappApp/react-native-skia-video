import { Platform } from 'react-native';
import { Skia, type SkImage } from 'react-native-skia';
import {
  GPUTextureUsage,
  importDevice,
  type GPUSharedFenceState,
  type GPUSharedTextureMemory,
} from 'react-native-webgpu';
import type { DecodedFrame, VideoFrame } from './types';

/**
 * What the worklets need to turn decoded frames into Skia images: Skia's GPU
 * device, imported with React Native WebGPU, and the React Native WebGPU
 * module. Both can be captured by worklets.
 */
export type FrameImageContext = {
  device: GPUDevice;
  webgpu: Pick<typeof RNWebGPU, 'createVideoFrameFromNativeBuffer'>;
};

let frameImageContext: FrameImageContext | null = null;

/**
 * Returns the context used to turn decoded frames into Skia images.
 * Must be called on the JS thread.
 */
export const getFrameImageContext = (): FrameImageContext => {
  if (frameImageContext == null) {
    if (typeof RNWebGPU === 'undefined') {
      throw new Error(
        '@azzapp/react-native-skia-video requires react-native-webgpu to ' +
          'draw video frames with React Native Skia'
      );
    }
    frameImageContext = {
      device: importDevice(Skia.getNativeDevice()),
      webgpu: RNWebGPU,
    };
  }
  return frameImageContext;
};

let nextFrameImagesId = 0;

/**
 * Returns a key identifying the frame images of a player, a composition player
 * or an export, see `makeVideoFrame`. The frames of a composition item use
 * `${key}:${itemId}`.
 */
export const createFrameImagesKey = () => `rnskv-${nextFrameImagesId++}`;

// Android: the decoders render the frames into a few hardware buffers in
// turn, guarded by sync fences (see `copySharedBuffer`).
const IS_ANDROID = Platform.OS === 'android';

// The hardware buffers of a key imported into Skia's device: a decoder's ring
// (2 buffers), plus the buffers of a previous size.
const MAX_SHARED_BUFFERS = 4;

type SharedBuffer = {
  handle: bigint;
  memory: GPUSharedTextureMemory;
  texture: GPUTexture;
};

type FrameTexture = {
  texture: GPUTexture | null;
  image: SkImage | null;
  /** The id of the frame copied into the texture (see DecodedFrame.id). */
  frameId: number | undefined;
  /** Android: the imported buffers, most recently used first. */
  sharedBuffers: SharedBuffer[];
  /**
   * Android: whether Skia's device waits for the frames on the GPU (see
   * `copySharedBuffer`).
   */
  gpuReadyWait?: boolean;
};

type FrameTextures = Record<string, FrameTexture>;

// The textures live on the runtime that draws the frames (the UI runtime or
// the export runtime): they are stored on that runtime's global object
// instead of being captured, so that they can be updated in place.
const getFrameTextures = (): FrameTextures => {
  'worklet';
  const global = globalThis as unknown as {
    __rnskvFrameTextures?: FrameTextures;
  };
  if (global.__rnskvFrameTextures == null) {
    global.__rnskvFrameTextures = {};
  }
  return global.__rnskvFrameTextures;
};

/**
 * Returns the texture of `state`, (re)created if it does not have the given
 * size.
 */
const getTexture = (
  device: GPUDevice,
  state: FrameTexture,
  width: number,
  height: number
): GPUTexture => {
  'worklet';
  if (
    state.texture == null ||
    state.texture.width !== width ||
    state.texture.height !== height
  ) {
    state.image?.dispose();
    state.image = null;
    state.texture?.destroy();
    state.texture = device.createTexture({
      size: [width, height],
      format: 'rgba8unorm',
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT |
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST,
    });
  }
  return state.texture;
};

/**
 * iOS: copies the frame (a `CVPixelBuffer`, converting YUV to RGB) into the
 * texture of `state` with React Native WebGPU's
 * `queue.copyExternalImageToTexture`, submitted on Skia's queue: the copy is
 * complete when Skia samples the texture.
 */
const copyNativeFrame = (
  device: GPUDevice,
  webgpu: FrameImageContext['webgpu'],
  state: FrameTexture,
  buffer: bigint,
  frame: DecodedFrame
): GPUTexture => {
  'worklet';
  const nativeFrame = webgpu.createVideoFrameFromNativeBuffer(buffer);
  try {
    const { width, height } = nativeFrame;
    const texture = getTexture(device, state, width, height);
    device.queue.copyExternalImageToTexture(
      { source: nativeFrame },
      { texture },
      [width, height]
    );
    return texture;
  } finally {
    nativeFrame.release();
    // Hand the buffer back to the decoder now rather than when the JS
    // wrapper is garbage collected.
    frame.release?.();
  }
};

/**
 * Begins the access to an imported buffer in a validation error scope, and
 * logs Dawn's error if it fails. Returns whether the access began.
 */
const beginAccessReporting = (
  device: GPUDevice,
  source: SharedBuffer,
  fences: GPUSharedFenceState[],
  label: string
): boolean => {
  'worklet';
  device.pushErrorScope('validation');
  let begun = false;
  try {
    source.memory.beginAccess(source.texture, true, fences);
    begun = true;
  } catch {
    // Reported below.
  }
  device.popErrorScope().then((dawnError) => {
    if (dawnError != null) {
      console.error(
        `[react-native-skia-video] ${label}: ${dawnError.message} ` +
          `(ready fences: ${fences.length}, sync-fd fences: ` +
          `${device.features.has('shared-fence-sync-fd')})`
      );
    }
  });
  return begun;
};

/**
 * Android: copies the frame (an RGBA `AHardwareBuffer` of a decoder's ring)
 * into the texture of `state`, on Skia's queue. The decoder renders into the
 * buffer with OpenGL, so both sides are synchronized on the GPU with sync
 * fences:
 * - the copy waits for the frame's ready fence, signaled once OpenGL is done
 *   rendering the frame;
 * - the fences signaled once the copy is done are handed back to the decoder
 *   (`frame.release(fences)`), that waits for them before rendering into the
 *   buffer again.
 *
 * The buffers are imported once and kept (a decoder renders into the same
 * few buffers in turn). An imported buffer is kept alive by Skia's device, so
 * that its handle cannot be reused by another buffer while it is cached.
 */
const copySharedBuffer = (
  device: GPUDevice,
  state: FrameTexture,
  handle: bigint,
  frame: DecodedFrame
): GPUTexture => {
  'worklet';
  const releaseFences: bigint[] = [];
  try {
    const { sharedBuffers } = state;
    const index = sharedBuffers.findIndex((shared) => shared.handle === handle);
    let source: SharedBuffer;
    if (index >= 0) {
      source = sharedBuffers[index]!;
      sharedBuffers.splice(index, 1);
    } else {
      const memory = device.importSharedTextureMemory({ handle });
      source = { handle, memory, texture: memory.createTexture() };
      if (sharedBuffers.length >= MAX_SHARED_BUFFERS) {
        sharedBuffers.pop()!.texture.destroy();
      }
    }
    sharedBuffers.unshift(source);

    // Skia's device waits for the frame's ready fence on the GPU if it can
    // import sync fds, and the CPU waits for it otherwise.
    state.gpuReadyWait ??= device.features.has('shared-fence-sync-fd');
    const readyFences: GPUSharedFenceState[] = [];
    if (frame.readyFence != null) {
      if (state.gpuReadyWait) {
        readyFences.push({
          // Imports a duplicate of the fence: the frame keeps its own.
          fence: device.importSharedFence({
            type: 'sync-fd',
            handle: frame.readyFence,
          }),
          // Dawn's Vulkan backend backs sync fds with binary semaphores, and
          // rejects any other signaled value than 1.
          signaledValue: BigInt(1),
        });
      } else {
        frame.waitForReady?.();
      }
    }
    try {
      source.memory.beginAccess(source.texture, true, readyFences);
    } catch (error) {
      // React Native WebGPU only reports that the access failed, Dawn's
      // reason goes to the device's error scopes: the access is tried again
      // in one, to report it. If it fails again, the frame is waited for on
      // the CPU and its buffer imported again, and the frames of the key are
      // waited for on the CPU from now on.
      if (!beginAccessReporting(device, source, readyFences, 'beginAccess')) {
        frame.waitForReady?.();
        sharedBuffers.shift();
        source.texture.destroy();
        const memory = device.importSharedTextureMemory({ handle });
        source = { handle, memory, texture: memory.createTexture() };
        sharedBuffers.unshift(source);
        if (!beginAccessReporting(device, source, [], 'fallback')) {
          throw error;
        }
        state.gpuReadyWait = false;
      }
    }
    const { width, height } = source.texture;
    const texture = getTexture(device, state, width, height);
    try {
      const encoder = device.createCommandEncoder();
      encoder.copyTextureToTexture({ texture: source.texture }, { texture }, [
        width,
        height,
      ]);
      device.queue.submit([encoder.finish()]);
    } finally {
      const { fences } = source.memory.endAccess(source.texture);
      for (const { fence } of fences) {
        const exported = fence.export();
        if (exported.type === 'sync-fd') {
          releaseFences.push(exported.handle);
        }
      }
    }
    return texture;
  } finally {
    // Takes ownership of the fences.
    frame.release?.(releaseFences);
  }
};

/**
 * Turns a decoded frame into a `VideoFrame` whose image can be drawn by Skia.
 *
 * The frame is copied on the GPU (see `copyNativeFrame` and
 * `copySharedBuffer`) into a texture of Skia's device that is reused for
 * every frame of the same `key`, and the texture is wrapped into an SkImage
 * without copy. The image of the previous frame of the same key is
 * disposed: frames are only valid until the next frame of the same key is
 * made.
 *
 * Must be called on the runtime that draws the frames.
 */
export const makeVideoFrame = (
  context: FrameImageContext,
  key: string,
  frame: DecodedFrame
): VideoFrame => {
  'worklet';
  const textures = getFrameTextures();
  let state = textures[key];
  if (state == null) {
    state = {
      texture: null,
      image: null,
      frameId: undefined,
      sharedBuffers: [],
    };
    textures[key] = state;
  }
  const { device, webgpu } = context;
  const buffer = frame.buffer;
  const frameId = frame.id;
  // A producer hands out its current frame again until a new one is decoded:
  // without its buffer once released (iOS), or with the same id (Android).
  // The frame was already copied into the texture.
  if (
    state.image != null &&
    (buffer == null || (frameId != null && frameId === state.frameId))
  ) {
    // Android: a frame handed out again carries a ready fence of its own.
    frame.release?.();
    return {
      image: state.image,
      width: frame.width,
      height: frame.height,
      rotation: frame.rotation,
    };
  }
  if (buffer == null) {
    throw new Error('The video frame was released before being drawn');
  }
  const texture = IS_ANDROID
    ? copySharedBuffer(device, state, buffer, frame)
    : copyNativeFrame(device, webgpu, state, buffer, frame);
  const previousImage = state.image;
  const image = Skia.Image.MakeImageFromGPUTexture(texture);
  state.image = image;
  state.frameId = frameId;
  previousImage?.dispose();
  return {
    image,
    width: frame.width,
    height: frame.height,
    rotation: frame.rotation,
  };
};

/**
 * Releases the textures and the images of the frames of `key` (and of the
 * items of `key`, `${key}:${itemId}`).
 *
 * Must be called on the runtime that drew the frames.
 */
export const releaseFrameImages = (key: string) => {
  'worklet';
  const textures = getFrameTextures();
  for (const textureKey of Object.keys(textures)) {
    if (textureKey !== key && !textureKey.startsWith(`${key}:`)) {
      continue;
    }
    const state = textures[textureKey]!;
    state.image?.dispose();
    state.texture?.destroy();
    for (const shared of state.sharedBuffers) {
      shared.texture.destroy();
    }
    delete textures[textureKey];
  }
};

/**
 * `makeVideoFrame` for the frames of the items of a composition, keyed by
 * item id.
 */
export const makeVideoFrames = (
  context: FrameImageContext,
  key: string,
  frames: Record<string, DecodedFrame>
): Record<string, VideoFrame> => {
  'worklet';
  const result: Record<string, VideoFrame> = {};
  for (const itemId of Object.keys(frames)) {
    result[itemId] = makeVideoFrame(
      context,
      `${key}:${itemId}`,
      frames[itemId]!
    );
  }
  return result;
};
