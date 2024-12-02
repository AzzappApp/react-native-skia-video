#import "VideoCompositionEncoderHostObject.h"
#import "JsiUtils.h"
#import <Metal/Metal.h>
#import <future>

NS_INLINE NSError* createErrorWithMessage(NSString* message) {
  return [NSError errorWithDomain:@"com.azzapp.rnskv"
                             code:0
                         userInfo:@{NSLocalizedDescriptionKey : message}];
}

namespace RNSkiaVideo {

VideoCompositionEncoderHostObject::VideoCompositionEncoderHostObject(
    std::string outPath, int width, int height, int frameRate, int bitRate) {
  this->outPath = outPath;
  this->width = width;
  this->height = height;
  this->frameRate = frameRate;
  this->bitRate = bitRate;
}


std::vector<jsi::PropNameID>
VideoCompositionEncoderHostObject::getPropertyNames(jsi::Runtime& rt) {
  std::vector<jsi::PropNameID> result;
  result.push_back(jsi::PropNameID::forUtf8(rt, std::string("prepare")));
  result.push_back(jsi::PropNameID::forUtf8(rt, std::string("encodeFrame")));
  result.push_back(jsi::PropNameID::forUtf8(rt, std::string("finishWriting")));
  result.push_back(jsi::PropNameID::forUtf8(rt, std::string("dispose")));
  return result;
}

jsi::Value
VideoCompositionEncoderHostObject::get(jsi::Runtime& runtime,
                                       const jsi::PropNameID& propNameId) {
  auto propName = propNameId.utf8(runtime);
  if (propName == "prepare") {
    return jsi::Function::createFromHostFunction(
        runtime, jsi::PropNameID::forAscii(runtime, "prepare"), 0,
        [this](jsi::Runtime& runtime, const jsi::Value& thisValue,
               const jsi::Value* arguments, size_t count) -> jsi::Value {
          prepare();
          return jsi::Value::undefined();
        });
  } if (propName == "encodeFrame") {
    return jsi::Function::createFromHostFunction(
        runtime, jsi::PropNameID::forAscii(runtime, "encodeFrame"), 2,
        [this](jsi::Runtime& runtime, const jsi::Value& thisValue,
               const jsi::Value* arguments, size_t count) -> jsi::Value {
          void *texturePointer = reinterpret_cast<void*>(arguments[0].asBigInt(runtime).asUint64(runtime));
          auto texture = (__bridge id<MTLTexture>)texturePointer;
          auto time =
              CMTimeMakeWithSeconds(arguments[1].asNumber(), NSEC_PER_SEC);

          encodeFrame(texture, time);
          return jsi::Value::undefined();
        });
  }
  if (propName == "finishWriting") {
    return jsi::Function::createFromHostFunction(
        runtime, jsi::PropNameID::forAscii(runtime, "finishWriting"), 0,
        [this](jsi::Runtime& runtime, const jsi::Value& thisValue,
               const jsi::Value* arguments, size_t count) -> jsi::Value {
          finish();
          return jsi::Value::undefined();
        });
  } else if (propName == "dispose") {
    return jsi::Function::createFromHostFunction(
        runtime, jsi::PropNameID::forAscii(runtime, "dispose"), 0,
        [this](jsi::Runtime& runtime, const jsi::Value& thisValue,
               const jsi::Value* arguments, size_t count) -> jsi::Value {
          this->release();
          return jsi::Value::undefined();
        });
  }
  return jsi::Value::undefined();
}

void VideoCompositionEncoderHostObject::prepare() {
  NSError* error = nil;
  assetWriter = [AVAssetWriter
      assetWriterWithURL:
          [NSURL fileURLWithPath:
                     [NSString
                         stringWithCString:outPath.c_str()
                                  encoding:[NSString defaultCStringEncoding]]]
                fileType:AVFileTypeMPEG4
                   error:&error];
  if (error) {
    throw error;
  }

  auto videoSettings = @{
    AVVideoCodecKey : AVVideoCodecTypeH264,
    AVVideoWidthKey : @(width),
    AVVideoHeightKey : @(height),
    AVVideoCompressionPropertiesKey : @{
      AVVideoAverageBitRateKey : @(bitRate),
      AVVideoMaxKeyFrameIntervalKey : @(frameRate),
      AVVideoProfileLevelKey : AVVideoProfileLevelH264HighAutoLevel,
    }
  };

  assetWriterInput =
      [AVAssetWriterInput assetWriterInputWithMediaType:AVMediaTypeVideo
                                         outputSettings:videoSettings];
  assetWriterInput.expectsMediaDataInRealTime = NO;
  assetWriterInput.performsMultiPassEncodingIfSupported = YES;
  if ([assetWriter canAddInput:assetWriterInput]) {
    [assetWriter addInput:assetWriterInput];
  } else {
    throw assetWriter.error
        ?: createErrorWithMessage(@"could not add output to asset writter");
    return;
  }
  [assetWriter startWriting];
  [assetWriter startSessionAtSourceTime:kCMTimeZero];

  device = MTLCreateSystemDefaultDevice();
  commandQueue = [device newCommandQueue];
}

void VideoCompositionEncoderHostObject::encodeFrame(id<MTLTexture> mlTexture,
                                                    CMTime time) {
  // Assuming mlTexture is your MTLResourceStorageModePrivate texture
  MTLTextureDescriptor* descriptor = [MTLTextureDescriptor
      texture2DDescriptorWithPixelFormat:mlTexture.pixelFormat
                                   width:mlTexture.width
                                  height:mlTexture.height
                               mipmapped:NO];
  descriptor.storageMode = MTLStorageModeShared;
  descriptor.pixelFormat = MTLPixelFormatBGRA8Unorm;
  id<MTLTexture> cpuAccessibleTexture =
      [device newTextureWithDescriptor:descriptor];

  id<MTLCommandBuffer> commandBuffer =
      [commandQueue commandBufferWithUnretainedReferences];
  id<MTLBlitCommandEncoder> blitEncoder = [commandBuffer blitCommandEncoder];
  [blitEncoder copyFromTexture:mlTexture
                   sourceSlice:0
                   sourceLevel:0
                  sourceOrigin:MTLOriginMake(0, 0, 0)
                    sourceSize:MTLSizeMake(mlTexture.width, mlTexture.height, 1)
                     toTexture:cpuAccessibleTexture
              destinationSlice:0
              destinationLevel:0
             destinationOrigin:MTLOriginMake(0, 0, 0)];

  [blitEncoder endEncoding];
  [commandBuffer commit];
  [commandBuffer waitUntilCompleted];

  CVPixelBufferRef pixelBuffer = NULL;
  NSDictionary* attributes = @{
    (NSString*)kCVPixelBufferPixelFormatTypeKey : @(kCVPixelFormatType_32BGRA),
    (NSString*)kCVPixelBufferWidthKey : @(width),
    (NSString*)kCVPixelBufferHeightKey : @(height),
    (NSString*)kCVPixelBufferMetalCompatibilityKey : @YES,
  };
  CVReturn status = CVPixelBufferCreate(
      kCFAllocatorDefault, width, height, kCVPixelFormatType_32BGRA,
      (__bridge CFDictionaryRef)attributes, &pixelBuffer);

  if (status != kCVReturnSuccess) {
    throw createErrorWithMessage(@"Could not extract pixels from frame");
    return;
  }
  CVPixelBufferLockBaseAddress(pixelBuffer, 0);
  void* pixelBufferBytes = CVPixelBufferGetBaseAddress(pixelBuffer);
  if (pixelBufferBytes == NULL) {
    throw createErrorWithMessage(@"Could not extract pixels from frame");
  }
  size_t bytesPerRow = CVPixelBufferGetBytesPerRow(pixelBuffer);

  MTLRegion region = MTLRegionMake2D(0, 0, width, height);

  [cpuAccessibleTexture getBytes:pixelBufferBytes
                     bytesPerRow:bytesPerRow
                      fromRegion:region
                     mipmapLevel:0];
  CVPixelBufferUnlockBaseAddress(pixelBuffer, 0);

  int attempt = 0;
  while (!assetWriterInput.isReadyForMoreMediaData) {
    if (attempt > 100) {
      CVPixelBufferRelease(pixelBuffer);
      [cpuAccessibleTexture setPurgeableState:MTLPurgeableStateEmpty];
      throw createErrorWithMessage(@"AVAssetWriter unavailable");
    }
    attempt++;
    usleep(5000);
  }

  CMSampleBufferRef sampleBuffer = NULL;
  CMVideoFormatDescriptionRef formatDescription = NULL;
  CMVideoFormatDescriptionCreateForImageBuffer(NULL, pixelBuffer,
                                               &formatDescription);
  CMSampleTimingInfo timingInfo = {.presentationTimeStamp = time,
                                   .decodeTimeStamp = kCMTimeInvalid};

  NSError* error;
  if (CMSampleBufferCreateForImageBuffer(kCFAllocatorDefault, pixelBuffer, true,
                                         NULL, NULL, formatDescription,
                                         &timingInfo, &sampleBuffer) != 0) {
    error = createErrorWithMessage(@"Could not create image buffer from frame");
  }
  if (sampleBuffer) {
    if (![assetWriterInput appendSampleBuffer:sampleBuffer]) {
      if (assetWriter.status == AVAssetWriterStatusFailed) {
        error = assetWriter.error
                    ?: createErrorWithMessage(
                           @"Could not append frame data to AVAssetWriter");
      }
    }
    CFRelease(sampleBuffer);
  } else {
    error = createErrorWithMessage(@"Failed to create sampleBuffer");
  }
  if (formatDescription) {
    CFRelease(formatDescription);
  };
  CVPixelBufferRelease(pixelBuffer);
  [cpuAccessibleTexture setPurgeableState:MTLPurgeableStateEmpty];
  if (error) {
    throw error;
  }
}

void VideoCompositionEncoderHostObject::finish() {

  __block std::promise<void> promise;
  std::future<void> future = promise.get_future();
  __block NSError* error = nil;
  [assetWriter finishWritingWithCompletionHandler:^{
    if (assetWriter.status == AVAssetWriterStatusFailed) {
      error = assetWriter.error ?: createErrorWithMessage(@"Failed to export");
      return;
    }
    promise.set_value();
  }];

  future.wait();
  if (error != nil) {
    throw error;
  }
}

void VideoCompositionEncoderHostObject::release() {
  if (assetWriter && assetWriter.status == AVAssetWriterStatusWriting) {
    [assetWriter cancelWriting];
  }
  assetWriter = nullptr;
  assetWriterInput = nullptr;
  commandQueue = nullptr;
  device = nullptr;
}

} // namespace RNSkiaVideo
