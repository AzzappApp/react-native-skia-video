import RNSkiaVideoModule from './RNSkiaVideoModule';
import * as __RNSkiaVideoBenchmark from './benchmarkStats';
import { Platform } from 'react-native';
import type { VideoCodec } from './types';

export { RNSkiaVideoModule as __RNSkiaVideoPrivateAPI, __RNSkiaVideoBenchmark };

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

/**
 * Whether this device can export a video in the given codec (see
 * `ExportOptions.codec`). H.264 always is; HEVC depends on the device.
 */
export const isExportCodecSupported = (codec: VideoCodec): boolean =>
  // A JS bundle updated over the air can run on a binary from before the
  // codec option: that one only encodes H.264, and ignores `codec`.
  typeof RNSkiaVideoModule.isExportCodecSupported === 'function'
    ? RNSkiaVideoModule.isExportCodecSupported(codec)
    : codec === 'h264';

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
