//
//  MTLTextureUtils.m
//  azzapp-react-native-skia-video
//
//  Created by François de Campredon on 02/12/2024.
//

#import "MTLTextureUtils.h"
#import <Metal/Metal.h>
#import <stdexcept>

@implementation MTLTextureUtils

inline CVMetalTextureCacheRef getTextureCache() {
  static CVMetalTextureCacheRef textureCache = nil;
  if (textureCache == nil) {
    // Create a new Texture Cache
    auto result = CVMetalTextureCacheCreate(kCFAllocatorDefault, nil,
                                            MTLCreateSystemDefaultDevice(), nil,
                                            &textureCache);
    if (result != kCVReturnSuccess || textureCache == nil) {
      throw std::runtime_error("Failed to create Metal Texture Cache!");
    }
  }
  return textureCache;
}
// caching the result of textureCache to improve perf(test in progress)
static CVMetalTextureCacheRef textureCache = getTextureCache();

+ (id<MTLTexture>)convertBGRACVPixelBufferRefToMTLTexture:
    (CVPixelBufferRef)pixelBuffer {
  size_t width = CVPixelBufferGetWidth(pixelBuffer);
  size_t height = CVPixelBufferGetHeight(pixelBuffer);
  CVMetalTextureRef cvMetalTexture = nullptr;
  CVReturn cvReturn = CVMetalTextureCacheCreateTextureFromImage(
      kCFAllocatorDefault, getTextureCache(), pixelBuffer, nullptr,
      MTLPixelFormatBGRA8Unorm, width, height, 0u, &cvMetalTexture);

  if (cvReturn != kCVReturnSuccess) {
    throw std::runtime_error(
        "Could not create Metal texture from pixel buffer");
  }

  auto mtlTexture = CVMetalTextureGetTexture(cvMetalTexture);
  CVBufferRelease(cvMetalTexture);
  return mtlTexture;
}

@end
