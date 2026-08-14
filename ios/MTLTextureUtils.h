//
//  MTLTextureUtils.h
//  azzapp-react-native-skia-video
//
//  Created by François de Campredon on 02/12/2024.
//

#import <CoreVideo/CoreVideo.h>
#import <Foundation/Foundation.h>
#import <Metal/Metal.h>

NS_ASSUME_NONNULL_BEGIN

@interface MTLTextureUtils : NSObject

/**
 * The device backing the texture cache below. Everything that blits to or
 * from a texture obtained from this class must use this device, since Metal
 * cannot mix resources across devices.
 */
+ (nullable id<MTLDevice>)device;

/**
 * Wraps a BGRA CVPixelBuffer into a Metal texture without copying: the
 * returned CVMetalTexture is a zero-copy view over the buffer's IOSurface.
 * The caller must keep the returned reference (and the pixel buffer) alive
 * for as long as the texture is in use, then CFRelease it, and call
 * `flushTextureCache` once done with the frame.
 */
+ (nullable CVMetalTextureRef)createTextureViewForPixelBuffer:
    (CVPixelBufferRef)pixelBuffer;

/**
 * Releases the cache's own references to the textures nobody holds anymore.
 * CoreVideo requires this to be called periodically: until it runs, the
 * cache keeps every IOSurface it has vended a texture for alive, which stops
 * the pixel buffer pools those surfaces belong to from ever recycling them.
 * Textures still retained by a caller are left untouched.
 */
+ (void)flushTextureCache;
@end

NS_ASSUME_NONNULL_END
