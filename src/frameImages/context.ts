// GPUDevice, GPUTexture and the other GPU* types are the standard WebGPU
// types: @webgpu/types declares them as globals, as TypeScript's DOM library
// does for the browser, and React Native WebGPU's own types build on them.
// There is no module to import them from.
/// <reference types="@webgpu/types" />
import { Platform } from 'react-native';
import { Skia } from 'react-native-skia';
import { importDevice } from 'react-native-webgpu';

// Android: the decoders hand their frames over in their own YUV buffers (see
// convertFrame.ts).
export const IS_ANDROID = Platform.OS === 'android';

// The Dawn feature Skia's device needs to sample the decoders' YUV buffers on
// Android.
const YUV_FEATURE = 'opaque-ycbcr-android-for-external-texture';

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
    // No GPU for Skia to render with (no Vulkan 1.1 on Android): there is no
    // device to convert the frames on, and Skia says why.
    const { gpu } = Skia;
    if (!gpu.isAvailable) {
      throw new Error(
        `@azzapp/react-native-skia-video can't draw video frames: ${gpu.error}`
      );
    }
    const device = importDevice(Skia.getNativeDevice());
    // Checked here rather than natively: React Native Skia creates its device
    // in its own native module and only hands it out to JS
    // (getNativeDevice), and this library's native code doesn't link Dawn.
    if (IS_ANDROID && !device.features.has(YUV_FEATURE)) {
      throw new Error(
        "@azzapp/react-native-skia-video can't draw video frames: the GPU " +
          `can't sample the decoders' YUV buffers (no '${YUV_FEATURE}' ` +
          "feature on Skia's device)"
      );
    }
    frameImageContext = { device, webgpu: RNWebGPU };
  }
  return frameImageContext;
};

let nextFrameImagesId = 0;

/**
 * Returns a key identifying the frames of a player, a composition player or
 * an export (see makeVideoFrame). The frames of a composition item use
 * `${key}:${itemId}`.
 */
export const createFrameImagesKey = () => `rnskv-${nextFrameImagesId++}`;
