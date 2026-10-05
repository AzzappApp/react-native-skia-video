//
//  RNSVPixelBufferRing.mm
//  azzapp-react-native-skia-video
//

#import "RNSVPixelBufferRing.h"
#import <Metal/Metal.h>
#import <stdexcept>
#import <vector>

// Number of buffers of a ring. The frame handed to JS is drawn while the next
// ones are decoded (React Native Skia replays the canvas on its own threads),
// so a frame must survive a couple of decodes before its buffer is reused.
static const size_t kRingCapacity = 3;

static id<MTLDevice> device;
static id<MTLCommandQueue> commandQueue;
static CVMetalTextureCacheRef metalTextureCache = NULL;

static void setupMetal() {
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    device = MTLCreateSystemDefaultDevice();
    commandQueue = [device newCommandQueue];
    CVReturn status = CVMetalTextureCacheCreate(
        kCFAllocatorDefault, NULL, device, NULL, &metalTextureCache);
    if (status != kCVReturnSuccess) {
      NSLog(@"Failed to create CVMetalTextureCache: %d", status);
      metalTextureCache = NULL;
    }
  });
  if (!metalTextureCache) {
    throw std::runtime_error("Metal texture cache is not available");
  }
}

static CVMetalTextureRef createMetalTexture(CVPixelBufferRef pixelBuffer) {
  CVMetalTextureRef texture = NULL;
  CVReturn status = CVMetalTextureCacheCreateTextureFromImage(
      kCFAllocatorDefault, metalTextureCache, pixelBuffer, NULL,
      MTLPixelFormatBGRA8Unorm, CVPixelBufferGetWidth(pixelBuffer),
      CVPixelBufferGetHeight(pixelBuffer), 0, &texture);
  if (status != kCVReturnSuccess || !texture) {
    throw std::runtime_error(
        "Failed to create Metal texture from CVPixelBuffer!");
  }
  return texture;
}

namespace {
struct Slot {
  CVPixelBufferRef buffer = NULL;
  CVMetalTextureRef texture = NULL;
};
} // namespace

@implementation RNSVPixelBufferRing {
  std::vector<Slot> _slots;
  size_t _nextSlot;
  size_t _width;
  size_t _height;
}

- (instancetype)init {
  self = [super init];
  if (self) {
    _slots.resize(kRingCapacity);
    _nextSlot = 0;
    _width = 0;
    _height = 0;
  }
  return self;
}

- (void)dealloc {
  [self releaseBuffersLocked];
}

- (CVPixelBufferRef)copyNextBufferFilledWith:(CVPixelBufferRef)source {
  @synchronized(self) {
    @autoreleasepool {
      return [self copyNextBufferFilledWithLocked:source];
    }
  }
}

- (CVPixelBufferRef)copyNextBufferFilledWithLocked:(CVPixelBufferRef)source {
  setupMetal();
  size_t width = CVPixelBufferGetWidth(source);
  size_t height = CVPixelBufferGetHeight(source);
  if (width != _width || height != _height) {
    [self releaseBuffersLocked];
    _width = width;
    _height = height;
  }

  Slot& slot = _slots[_nextSlot];
  _nextSlot = (_nextSlot + 1) % _slots.size();
  if (!slot.buffer) {
    NSDictionary* attributes = @{
      (id)kCVPixelBufferIOSurfacePropertiesKey : @{},
      (id)kCVPixelBufferMetalCompatibilityKey : @YES,
    };
    CVPixelBufferRef buffer = NULL;
    CVReturn status = CVPixelBufferCreate(
        kCFAllocatorDefault, width, height, kCVPixelFormatType_32BGRA,
        (__bridge CFDictionaryRef)attributes, &buffer);
    if (status != kCVReturnSuccess || !buffer) {
      throw std::runtime_error("Failed to allocate the frame pixel buffer!");
    }
    try {
      slot.texture = createMetalTexture(buffer);
    } catch (...) {
      CVPixelBufferRelease(buffer);
      throw;
    }
    slot.buffer = buffer;
  }

  CVMetalTextureRef sourceTexture = createMetalTexture(source);
  id<MTLTexture> src = CVMetalTextureGetTexture(sourceTexture);
  id<MTLTexture> dst = CVMetalTextureGetTexture(slot.texture);

  id<MTLCommandBuffer> commandBuffer = [commandQueue commandBuffer];
  id<MTLBlitCommandEncoder> blitEncoder = [commandBuffer blitCommandEncoder];
  [blitEncoder copyFromTexture:src
                   sourceSlice:0
                   sourceLevel:0
                  sourceOrigin:MTLOriginMake(0, 0, 0)
                    sourceSize:MTLSizeMake(width, height, 1)
                     toTexture:dst
              destinationSlice:0
              destinationLevel:0
             destinationOrigin:MTLOriginMake(0, 0, 0)];
  [blitEncoder endEncoding];
  [commandBuffer commit];
  // React Native Skia samples the buffer without waiting on any GPU fence:
  // the copy must be complete before the frame is handed out.
  [commandBuffer waitUntilCompleted];
  CFRelease(sourceTexture);
  return CVPixelBufferRetain(slot.buffer);
}

- (void)releaseBuffers {
  @synchronized(self) {
    [self releaseBuffersLocked];
  }
}

- (void)releaseBuffersLocked {
  for (auto& slot : _slots) {
    if (slot.texture) {
      CFRelease(slot.texture);
      slot.texture = NULL;
    }
    if (slot.buffer) {
      CVPixelBufferRelease(slot.buffer);
      slot.buffer = NULL;
    }
  }
  _nextSlot = 0;
}

+ (void)flushTextureCache {
  if (metalTextureCache) {
    CVMetalTextureCacheFlush(metalTextureCache, 0);
  }
}

@end
