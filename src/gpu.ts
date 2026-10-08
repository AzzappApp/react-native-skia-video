import { Platform } from 'react-native';
import { Skia } from 'react-native-skia';
import type { SkImage } from 'react-native-skia';
import { GPUTextureUsage, importDevice } from 'react-native-webgpu';
import type { NativeVideoFrame, VideoFrame } from './types';

let sharedDevice: GPUDevice | null = null;

/**
 * Returns the GPU device Skia renders with, as a WebGPU `GPUDevice`.
 * Textures shared between Skia and this library must live on this device.
 *
 * Must be called on the main JS runtime: the device is then captured by the
 * worklets that use it.
 */
export const getSharedDevice = (): GPUDevice => {
  if (sharedDevice == null) {
    sharedDevice = importDevice(Skia.getNativeDevice());
  }
  return sharedDevice;
};

/**
 * Whether the fences returned by `GPUSharedTextureMemory.endAccess()` must be
 * handed to the encoder (sync file descriptors on Android).
 */
export const exportsSyncFdFences = Platform.OS === 'android';

const COPY_TARGET_USAGE =
  GPUTextureUsage.COPY_DST |
  GPUTextureUsage.COPY_SRC |
  GPUTextureUsage.TEXTURE_BINDING |
  GPUTextureUsage.RENDER_ATTACHMENT;

type FrameSlot = {
  texture: GPUTexture;
  image: SkImage;
  width: number;
  height: number;
  format: GPUTextureFormat;
};

/**
 * Converts the native frames produced by the decoders (IOSurface on iOS,
 * AHardwareBuffer on Android) into Skia images.
 *
 * Each frame is copied on the GPU into a texture owned by the importer (one
 * per key, reused as long as the frame size does not change), so that the
 * native buffer can be recycled by the decoder right away.
 */
export type FrameImporter = {
  /**
   * Imports a native frame.
   *
   * @param key The key of the texture to copy the frame into.
   * @param frame The native frame.
   * @param newImage Whether to return a new SkImage object (wrapping the same
   * texture). A new object is what makes a Skia canvas redraw.
   */
  importFrame(
    key: string,
    frame: NativeVideoFrame,
    newImage?: boolean
  ): VideoFrame | null;
  /**
   * Imports all the frames of a composition.
   */
  importFrames(
    frames: Record<string, NativeVideoFrame>
  ): Record<string, VideoFrame>;
  /**
   * Releases the textures and images of the importer.
   */
  dispose(): void;
};

/**
 * Creates a frame importer. This is a worklet: the importer must be created
 * on the runtime that uses it.
 */
export const createFrameImporter = (device: GPUDevice): FrameImporter => {
  'worklet';
  let slots: Record<string, FrameSlot> = {};

  const releaseSlot = (slot: FrameSlot) => {
    // Drop the image before the texture it samples.
    slot.image.dispose();
    slot.texture.destroy();
  };

  const importFrame = (
    key: string,
    frame: NativeVideoFrame,
    newImage = false
  ): VideoFrame | null => {
    if (frame == null || frame.handle == null) {
      return null;
    }
    const memory = device.importSharedTextureMemory({ handle: frame.handle });
    const source = memory.createTexture();
    try {
      const { width, height, format } = source;
      let slot = slots[key];
      if (
        !slot ||
        slot.width !== width ||
        slot.height !== height ||
        slot.format !== format
      ) {
        if (slot) {
          releaseSlot(slot);
        }
        const texture = device.createTexture({
          label: `RNSkiaVideoFrame-${key}`,
          size: [width, height],
          format,
          usage: COPY_TARGET_USAGE,
        });
        slot = {
          texture,
          image: Skia.Image.MakeImageFromGPUTexture(texture),
          width,
          height,
          format,
        };
        slots[key] = slot;
      }

      memory.beginAccess(source, true);
      const encoder = device.createCommandEncoder();
      encoder.copyTextureToTexture(
        { texture: source },
        { texture: slot.texture },
        [width, height]
      );
      device.queue.submit([encoder.finish()]);
      memory.endAccess(source);

      let image = slot.image;
      if (newImage) {
        // The previous image object only wraps the texture: disposing it
        // does not affect the drawings that already captured it.
        const previous = slot.image;
        image = Skia.Image.MakeImageFromGPUTexture(slot.texture);
        slot.image = image;
        previous.dispose();
      }
      return {
        image,
        width: frame.width,
        height: frame.height,
        rotation: frame.rotation,
      };
    } finally {
      source.destroy();
    }
  };

  return {
    importFrame,
    importFrames(frames) {
      const result: Record<string, VideoFrame> = {};
      for (const key of Object.keys(frames)) {
        const frame = importFrame(key, frames[key]!);
        if (frame) {
          result[key] = frame;
        }
      }
      return result;
    },
    dispose() {
      for (const key of Object.keys(slots)) {
        releaseSlot(slots[key]!);
      }
      slots = {};
    },
  };
};

type ImporterRegistry = Record<string, FrameImporter>;

/**
 * Returns the frame importer registered under the given id on the calling
 * runtime, creating it if needed.
 */
export const getFrameImporter = (
  id: string,
  device: GPUDevice
): FrameImporter => {
  'worklet';
  const g = globalThis as unknown as {
    __rnskvFrameImporters?: ImporterRegistry;
  };
  if (!g.__rnskvFrameImporters) {
    g.__rnskvFrameImporters = {};
  }
  let importer = g.__rnskvFrameImporters[id];
  if (!importer) {
    importer = createFrameImporter(device);
    g.__rnskvFrameImporters[id] = importer;
  }
  return importer;
};

/**
 * Disposes the frame importer registered under the given id on the calling
 * runtime.
 */
export const disposeFrameImporter = (id: string) => {
  'worklet';
  const g = globalThis as unknown as {
    __rnskvFrameImporters?: ImporterRegistry;
  };
  const importer = g.__rnskvFrameImporters?.[id];
  if (importer) {
    importer.dispose();
    delete g.__rnskvFrameImporters![id];
  }
};

let importerCounter = 0;

/**
 * Returns a new unique frame importer id.
 */
export const nextFrameImporterId = () => `rnskv-importer-${importerCounter++}`;
