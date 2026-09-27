import RNSkiaVideoModule from './RNSkiaVideoModule.js';
export { RNSkiaVideoModule as __RNSkiaVideoPrivateAPI };
export * from './types.js';
export * from './videoPlayer.js';
export * from './videoCompositionPlayer.js';
export * from './exportVideoComposition.js';
export * from './videoFrameImage.js';
export declare const getValidEncoderConfigurations: typeof RNSkiaVideoModule.getValidEncoderConfigurations;
export declare const getDecodingCapabilitiesFor: typeof RNSkiaVideoModule.getDecodingCapabilitiesFor;
/**
 * Whether the device can encode with the given codec.
 *
 * Unlike the two above this is answered on both platforms. Use it to decide
 * whether to offer a codec at all; exports fall back to H.264 by themselves
 * when the answer is false.
 */
export declare const isEncodingSupported: typeof RNSkiaVideoModule.isEncodingSupported;
//# sourceMappingURL=index.d.ts.map