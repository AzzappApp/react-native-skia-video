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

static id<MTLDevice> device =  MTLCreateSystemDefaultDevice();
static id<MTLCommandQueue> commandQueue = [device newCommandQueue];

+ (nullable id<MTLTexture>)createMTLTextureForVideoOutput:(CGSize)size {
  MTLTextureDescriptor* descriptor = [[MTLTextureDescriptor alloc] init];
  descriptor.pixelFormat = MTLPixelFormatBGRA8Unorm;
  descriptor.width = size.width;
  descriptor.height = size.height;
  descriptor.usage = MTLTextureUsageShaderRead | MTLTextureUsageShaderWrite;
  descriptor.storageMode = MTLStorageModePrivate;

  return [device newTextureWithDescriptor:descriptor];
}

+(void)updateTexture:(id<MTLTexture>)mtlTexture with:(CVPixelBufferRef)pixelBuffer {
  CVPixelBufferLockBaseAddress(pixelBuffer, kCVPixelBufferLock_ReadOnly);

  size_t width = CVPixelBufferGetWidth(pixelBuffer);
  size_t height = CVPixelBufferGetHeight(pixelBuffer);
  size_t bytesPerRow = CVPixelBufferGetBytesPerRow(pixelBuffer);
  void* baseAddress = CVPixelBufferGetBaseAddress(pixelBuffer);

  if (!baseAddress) {
    CVPixelBufferUnlockBaseAddress(pixelBuffer, kCVPixelBufferLock_ReadOnly);
    throw std::runtime_error("Failed to get base address of CVPixelBuffer!");
  }

  if (width > mtlTexture.width || height > mtlTexture.height) {
    CVPixelBufferUnlockBaseAddress(pixelBuffer, kCVPixelBufferLock_ReadOnly);
    throw std::runtime_error(
        "Pixel buffer dimensions exceed texture dimensions!");
  }

  id<MTLBuffer> stagingBuffer =
      [device newBufferWithLength:bytesPerRow * height
                          options:MTLResourceStorageModeShared];
  if (!stagingBuffer) {
    CVPixelBufferUnlockBaseAddress(pixelBuffer, kCVPixelBufferLock_ReadOnly);
    throw std::runtime_error("Failed to create staging buffer!");
  }

  memcpy(stagingBuffer.contents, baseAddress, bytesPerRow * height);

  id<MTLCommandBuffer> commandBuffer =
      [commandQueue commandBufferWithUnretainedReferences];
  id<MTLBlitCommandEncoder> blitEncoder = [commandBuffer blitCommandEncoder];

  MTLRegion region = MTLRegionMake2D(0, 0, width, height);

  [blitEncoder copyFromBuffer:stagingBuffer
                 sourceOffset:0
            sourceBytesPerRow:bytesPerRow
          sourceBytesPerImage:bytesPerRow * height
                   sourceSize:region.size
                    toTexture:mtlTexture
             destinationSlice:0
             destinationLevel:0
            destinationOrigin:region.origin];

  [blitEncoder endEncoding];
  [commandBuffer commit];
  [commandBuffer waitUntilCompleted];

  [stagingBuffer setPurgeableState:MTLPurgeableStateEmpty];
  stagingBuffer = nil;

  CVPixelBufferUnlockBaseAddress(pixelBuffer, kCVPixelBufferLock_ReadOnly);
}

@end
