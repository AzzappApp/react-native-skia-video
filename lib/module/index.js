"use strict";

import RNSkiaVideoModule from "./RNSkiaVideoModule.js";
import { Platform } from 'react-native';
export { RNSkiaVideoModule as __RNSkiaVideoPrivateAPI };
export * from "./types.js";
export * from "./videoPlayer.js";
export * from "./videoCompositionPlayer.js";
export * from "./exportVideoComposition.js";
export * from "./videoFrameImage.js";
export const getValidEncoderConfigurations = (...args) => {
  if (Platform.OS === 'android') {
    return RNSkiaVideoModule.getValidEncoderConfigurations(...args);
  } else {
    throw new Error('getValidEncoderConfigurations is only available on Android');
  }
};
export const getDecodingCapabilitiesFor = (...args) => {
  if (Platform.OS === 'android') {
    return RNSkiaVideoModule.getDecodingCapabilitiesFor(...args);
  } else {
    throw new Error('getDecodingCapabilitiesFor is only available on Android');
  }
};

/**
 * Whether the device can encode with the given codec.
 *
 * Unlike the two above this is answered on both platforms. Use it to decide
 * whether to offer a codec at all; exports fall back to H.264 by themselves
 * when the answer is false.
 */
export const isEncodingSupported = (...args) => RNSkiaVideoModule.isEncodingSupported(...args);
//# sourceMappingURL=index.js.map