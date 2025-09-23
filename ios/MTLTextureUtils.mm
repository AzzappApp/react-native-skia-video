//
//  MTLTextureUtils.m
//  sheunglaili-react-native-skia-video
//
//  Created by François de Campredon on 02/12/2024.
//

#import "MTLTextureUtils.h"
#import <Metal/Metal.h>
#import <stdexcept>

@implementation MTLTextureUtils

static id<MTLDevice> device;
inline id<MTLDevice> getDevice() {
  if (!device) {
    device = MTLCreateSystemDefaultDevice();
  }
  return device;
}

static id<MTLCommandQueue> commandQueue;
inline id<MTLCommandQueue> getCommandQueue() {
  if (!commandQueue) {
    auto device = getDevice();
    commandQueue = [device newCommandQueue];
  }
  return commandQueue;
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

+ (nullable id<MTLTexture>)createMTLTextureForVideoOutput:(CGSize)size {
  MTLTextureDescriptor* descriptor = [[MTLTextureDescriptor alloc] init];
  descriptor.pixelFormat = MTLPixelFormatBGRA8Unorm;
  descriptor.width = size.width;
  descriptor.height = size.height;
  descriptor.usage = MTLTextureUsageShaderRead | MTLTextureUsageShaderWrite;
  descriptor.storageMode = MTLStorageModePrivate;

  auto device = getDevice();
  return [device newTextureWithDescriptor:descriptor];
}

+ (void)updateTexture:(id<MTLTexture>)mtlTexture
                 with:(CVPixelBufferRef)pixelBuffer {
  CVPixelBufferLockBaseAddress(pixelBuffer, kCVPixelBufferLock_ReadOnly);

  size_t width = CVPixelBufferGetWidth(pixelBuffer);
  size_t height = CVPixelBufferGetHeight(pixelBuffer);

  if (width > mtlTexture.width || height > mtlTexture.height) {
    CVPixelBufferUnlockBaseAddress(pixelBuffer, kCVPixelBufferLock_ReadOnly);
    throw std::runtime_error(
        "Pixel buffer dimensions exceed texture dimensions!");
  }

  // Use CVMetalTextureCache to create a Metal texture directly from the pixel
  // buffer
  CVMetalTextureRef cvMetalTexture = NULL;
  CVReturn status = CVMetalTextureCacheCreateTextureFromImage(
      NULL, getMetalTextureCache(), pixelBuffer, NULL, MTLPixelFormatBGRA8Unorm,
      width, height, 0, &cvMetalTexture);

  if (status != kCVReturnSuccess || !cvMetalTexture) {
    CVPixelBufferUnlockBaseAddress(pixelBuffer, kCVPixelBufferLock_ReadOnly);
    throw std::runtime_error(
        "Failed to create Metal texture from CVPixelBuffer!");
  }

  id<MTLTexture> tempTexture = CVMetalTextureGetTexture(cvMetalTexture);

  // Copy the Metal-compatible texture to the destination texture
  auto commandQueue = getCommandQueue();
  id<MTLCommandBuffer> commandBuffer = [commandQueue commandBuffer];
  id<MTLBlitCommandEncoder> blitEncoder = [commandBuffer blitCommandEncoder];

  MTLRegion region = MTLRegionMake2D(0, 0, width, height);

  [blitEncoder copyFromTexture:tempTexture
                   sourceSlice:0
                   sourceLevel:0
                  sourceOrigin:region.origin
                    sourceSize:region.size
                     toTexture:mtlTexture
              destinationSlice:0
              destinationLevel:0
             destinationOrigin:region.origin];

  [blitEncoder endEncoding];
  [commandBuffer commit];
  [commandBuffer waitUntilCompleted];

  CFRelease(cvMetalTexture);
  CVPixelBufferUnlockBaseAddress(pixelBuffer, kCVPixelBufferLock_ReadOnly);
}

@end
