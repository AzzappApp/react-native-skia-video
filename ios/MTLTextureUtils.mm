//
//  MTLTextureUtils.m
//  azzapp-react-native-skia-video
//
//  Created by François de Campredon on 02/12/2024.
//

#import "MTLTextureUtils.h"
#import <Metal/Metal.h>

@implementation MTLTextureUtils

+ (nullable id<MTLDevice>)device {
  static id<MTLDevice> device = nil;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    device = MTLCreateSystemDefaultDevice();
  });
  return device;
}

// The cache is reached from the decoder queues, the render thread and the
// export thread, sometimes concurrently, and CVMetalTextureCache makes no
// thread-safety promise, so every access to it goes through this class and is
// serialized on it.
static CVMetalTextureCacheRef metalTextureCache = NULL;

// Callers must hold the class lock.
+ (nullable CVMetalTextureCacheRef)cacheLocked {
  if (!metalTextureCache) {
    CVReturn status = CVMetalTextureCacheCreate(
        kCFAllocatorDefault, NULL, [self device], NULL, &metalTextureCache);
    if (status != kCVReturnSuccess) {
      NSLog(@"Failed to create CVMetalTextureCache: %d", status);
      metalTextureCache = NULL;
    }
  }
  return metalTextureCache;
}

+ (nullable CVMetalTextureRef)createTextureViewForPixelBuffer:
    (CVPixelBufferRef)pixelBuffer {
  size_t width = CVPixelBufferGetWidth(pixelBuffer);
  size_t height = CVPixelBufferGetHeight(pixelBuffer);

  CVMetalTextureRef cvMetalTexture = NULL;
  @synchronized(self) {
    CVMetalTextureCacheRef cache = [self cacheLocked];
    if (!cache) {
      return NULL;
    }
    CVReturn status = CVMetalTextureCacheCreateTextureFromImage(
        kCFAllocatorDefault, cache, pixelBuffer, NULL, MTLPixelFormatBGRA8Unorm,
        width, height, 0, &cvMetalTexture);
    if (status != kCVReturnSuccess && cvMetalTexture) {
      CFRelease(cvMetalTexture);
      cvMetalTexture = NULL;
    }
  }
  return cvMetalTexture;
}

+ (void)flushTextureCache {
  @synchronized(self) {
    if (metalTextureCache) {
      CVMetalTextureCacheFlush(metalTextureCache, 0);
    }
  }
}

@end
