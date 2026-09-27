import RNSkiaVideoModule from './RNSkiaVideoModule';
import { Platform } from 'react-native';

export { RNSkiaVideoModule as __RNSkiaVideoPrivateAPI };

export * from './types';
export * from './videoPlayer';
export * from './videoCompositionPlayer';
export * from './exportVideoComposition';
export * from './videoFrameImage';

export const getValidEncoderConfigurations: typeof RNSkiaVideoModule.getValidEncoderConfigurations =
  (...args) => {
    if (Platform.OS === 'android') {
      return RNSkiaVideoModule.getValidEncoderConfigurations(...args);
    } else {
      throw new Error(
        'getValidEncoderConfigurations is only available on Android'
      );
    }
  };

export const getDecodingCapabilitiesFor: typeof RNSkiaVideoModule.getDecodingCapabilitiesFor =
  (...args) => {
    if (Platform.OS === 'android') {
      return RNSkiaVideoModule.getDecodingCapabilitiesFor(...args);
    } else {
      throw new Error(
        'getDecodingCapabilitiesFor is only available on Android'
      );
    }
  };

/**
 * Whether the device can encode with the given codec.
 *
 * Unlike the two above this is answered on both platforms. Use it to decide
 * whether to offer a codec at all; exports fall back to H.264 by themselves
 * when the answer is false.
 */
export const isEncodingSupported: typeof RNSkiaVideoModule.isEncodingSupported =
  (...args) => RNSkiaVideoModule.isEncodingSupported(...args);
