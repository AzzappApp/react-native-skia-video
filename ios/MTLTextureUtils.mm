//
//  MTLTextureUtils.m
//  azzapp-react-native-skia-video
//
//  Created by François de Campredon on 02/12/2024.
//

#import "MTLTextureUtils.h"
#import <Metal/Metal.h>

@implementation MTLTextureUtils

static id<MTLDevice> device;
inline id<MTLDevice> getDevice() {
  if (!device) {
    device = MTLCreateSystemDefaultDevice();
  }
  return device;
}

static CVMetalTextureCacheRef metalTextureCache = NULL;
CVMetalTextureCacheRef getMetalTextureCache() {
  if (!metalTextureCache) {
    CVReturn status = CVMetalTextureCacheCreate(
        kCFAllocatorDefault, NULL, getDevice(), NULL, &metalTextureCache);
    if (status != kCVReturnSuccess) {
      NSLog(@"Failed to create CVMetalTextureCache: %d", status);
      metalTextureCache = NULL;
    }
  }
  return metalTextureCache;
}

+ (nullable CVMetalTextureRef)createTextureViewForPixelBuffer:
    (CVPixelBufferRef)pixelBuffer {
  CVMetalTextureCacheRef cache = getMetalTextureCache();
  if (!cache) {
    return NULL;
  }
  size_t width = CVPixelBufferGetWidth(pixelBuffer);
  size_t height = CVPixelBufferGetHeight(pixelBuffer);

  CVMetalTextureRef cvMetalTexture = NULL;
  CVReturn status = CVMetalTextureCacheCreateTextureFromImage(
      kCFAllocatorDefault, cache, pixelBuffer, NULL, MTLPixelFormatBGRA8Unorm,
      width, height, 0, &cvMetalTexture);
  if (status != kCVReturnSuccess || !cvMetalTexture) {
    return NULL;
  }
  return cvMetalTexture;
}

+ (void)flushTextureCache {
  if (metalTextureCache) {
    CVMetalTextureCacheFlush(metalTextureCache, 0);
  }
}

@end
