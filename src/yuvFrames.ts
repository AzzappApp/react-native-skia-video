import { Platform } from 'react-native';
import RNSkiaVideoModule from './RNSkiaVideoModule';
import type { FrameImageContext } from './frameImages';

let checked = false;

/**
 * Android: lets the composition decoders hand their frames over in their own
 * YUV buffers (rather than render them into RGBA buffers with OpenGL) if
 * Skia's device can sample them. Checked once, before the first composition
 * decoders are prepared.
 */
export const checkYUVFramesSupport = (context: FrameImageContext) => {
  if (checked || Platform.OS !== 'android') {
    return;
  }
  checked = true;
  RNSkiaVideoModule.setYUVFramesSupported?.(
    Number(Platform.Version) >= 29 &&
      context.device.features.has('opaque-ycbcr-android-for-external-texture')
  );
};
