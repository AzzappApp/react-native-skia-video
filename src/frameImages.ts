import { Skia, type SkImage } from 'react-native-skia';
import { GPUTextureUsage, importDevice } from 'react-native-webgpu';
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

type FrameTexture = {
  texture: GPUTexture | null;
  image: SkImage | null;
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
 * Turns a decoded frame into a `VideoFrame` whose image can be drawn by Skia.
 *
 * The frame is copied on the GPU (React Native WebGPU's
 * `queue.copyExternalImageToTexture`) into a texture of Skia's device that is
 * reused for every frame of the same `key`, and the texture is wrapped into an
 * SkImage without copy. The image of the previous frame of the same key is
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
    state = { texture: null, image: null };
    textures[key] = state;
  }
  const { device, webgpu } = context;
  const nativeFrame = webgpu.createVideoFrameFromNativeBuffer(frame.buffer);
  let texture: GPUTexture;
  try {
    const { width, height } = nativeFrame;
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
          GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
    }
    texture = state.texture;
    // A GPU copy, submitted on Skia's queue: the copy is complete when Skia
    // samples the texture. The native frame can be released right away.
    device.queue.copyExternalImageToTexture(
      { source: nativeFrame },
      { texture },
      [width, height]
    );
  } finally {
    nativeFrame.release();
  }
  const previousImage = state.image;
  const image = Skia.Image.MakeImageFromGPUTexture(texture);
  state.image = image;
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
