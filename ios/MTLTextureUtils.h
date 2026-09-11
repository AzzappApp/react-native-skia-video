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

+ (nullable id<MTLTexture>)createMTLTextureForVideoOutput:(CGSize)size;
+ (void)updateTexture:(id<MTLTexture>)texture with:(CVPixelBufferRef)buffer;
/**
 * Wraps the pixel buffer's IOSurface in a Metal texture through the shared
 * texture cache, without copying a single pixel. The returned reference is +1:
 * keep it, and the pixel buffer, alive as long as the texture is in use, then
 * CFRelease it. Returns NULL when the buffer cannot be wrapped.
 */
+ (nullable CVMetalTextureRef)createMetalTextureFromPixelBuffer:
    (CVPixelBufferRef)buffer CF_RETURNS_RETAINED;
+ (void)flushTextureCache;
@end

NS_ASSUME_NONNULL_END
