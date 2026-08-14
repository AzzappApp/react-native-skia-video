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
 * Wraps a BGRA CVPixelBuffer into a Metal texture without copying: the
 * returned CVMetalTexture is a zero-copy view over the buffer's IOSurface.
 * The caller must keep the returned reference (and the pixel buffer) alive
 * for as long as the texture is in use, then CFRelease it.
 */
+ (nullable CVMetalTextureRef)createTextureViewForPixelBuffer:
    (CVPixelBufferRef)pixelBuffer;

+ (void)flushTextureCache;
@end

NS_ASSUME_NONNULL_END
