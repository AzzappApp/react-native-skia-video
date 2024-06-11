import RNSkiaVideoModule from './RNSkiaVideoModule';
import { Platform } from 'react-native';

export { RNSkiaVideoModule as __RNSkiaVideoPrivateAPI };

export * from './types';
export * from './videoPlayer';
export * from './videoCompositionPlayer';
export * from './exportVideoComposition';

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
