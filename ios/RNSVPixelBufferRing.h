//
//  RNSVPixelBufferRing.h
//  azzapp-react-native-skia-video
//

#import <CoreVideo/CoreVideo.h>
#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * A fixed set of IOSurface-backed BGRA pixel buffers that decoded video frames
 * are copied into before being handed to JS.
 *
 * React Native Skia imports a frame with
 * `Skia.Image.MakeImageFromNativeBuffer`, which wraps the buffer's IOSurface
 * without copying it. Copying the decoder output into buffers owned by the
 * ring (instead of handing out the decoder's own buffers) keeps the memory
 * used by the frames bounded, whatever the JS garbage collector does, and
 * leaves the decoder free to recycle its buffers. The buffers are used in
 * turn, so a frame stays untouched while the following ones are decoded.
 */
@interface RNSVPixelBufferRing : NSObject

- (instancetype)init;

/**
 * Copies `source` (a Metal compatible BGRA pixel buffer) into the next buffer
 * of the ring and returns it, retained: the caller must release it with
 * CVPixelBufferRelease. The copy is complete when this method returns.
 *
 * Thread safe.
 */
- (CVPixelBufferRef)copyNextBufferFilledWith:(CVPixelBufferRef)source
    CF_RETURNS_RETAINED;

/**
 * Releases the ring's references on its buffers (the buffers still retained
 * elsewhere stay alive).
 *
 * Thread safe.
 */
- (void)releaseBuffers;

/**
 * Flushes the Metal texture cache used for the copies.
 */
+ (void)flushTextureCache;

@end

NS_ASSUME_NONNULL_END
