#import "VideoEncoderHostObject.h"
#import "JsiUtils.h"
#import <Metal/Metal.h>
#import <future>

NS_INLINE NSError* createErrorWithMessage(NSString* message) {
  return [NSError errorWithDomain:@"com.azzapp.rnskv"
                             code:0
                         userInfo:@{NSLocalizedDescriptionKey : message}];
}

namespace RNSkiaVideo {

VideoEncoderHostObject::VideoEncoderHostObject(std::string outPath, int width,
                                               int height, int frameRate,
                                               int bitRate) {
  this->outPath = outPath;
  this->width = width;
  this->height = height;
  this->frameRate = frameRate;
  this->bitRate = bitRate;
}

std::vector<jsi::PropNameID>
VideoEncoderHostObject::getPropertyNames(jsi::Runtime& rt) {
  std::vector<jsi::PropNameID> result;
  result.push_back(jsi::PropNameID::forUtf8(rt, std::string("prepare")));
  result.push_back(jsi::PropNameID::forUtf8(rt, std::string("encodeFrame")));
  result.push_back(jsi::PropNameID::forUtf8(rt, std::string("finishWriting")));
  result.push_back(jsi::PropNameID::forUtf8(rt, std::string("dispose")));
  return result;
}

jsi::Value VideoEncoderHostObject::get(jsi::Runtime& runtime,
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
  }
  if (propName == "encodeFrame") {
    return jsi::Function::createFromHostFunction(
        runtime, jsi::PropNameID::forAscii(runtime, "encodeFrame"), 2,
        [this](jsi::Runtime& runtime, const jsi::Value& thisValue,
               const jsi::Value* arguments, size_t count) -> jsi::Value {
          auto serializedTexture =
              arguments[0].asObject(runtime).getProperty(runtime, "mtlTexture");
          void* texturePointer = reinterpret_cast<void*>(
              serializedTexture.asBigInt(runtime).asUint64(runtime));
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

void VideoEncoderHostObject::prepare() {
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
  CVMetalTextureCacheCreate(NULL, NULL, device, NULL, &metalTextureCache);
}

void VideoEncoderHostObject::encodeFrame(id<MTLTexture> mlTexture,
                                         CMTime time) {
  // Create CVPixelBuffer with Metal compatibility
  CVPixelBufferRef pixelBuffer = NULL;
  NSDictionary* attributes = @{
    (NSString*)kCVPixelBufferPixelFormatTypeKey : @(kCVPixelFormatType_32BGRA),
    (NSString*)kCVPixelBufferWidthKey : @(mlTexture.width),
    (NSString*)kCVPixelBufferHeightKey : @(mlTexture.height),
    (NSString*)kCVPixelBufferMetalCompatibilityKey : @YES
  };
  CVReturn status =
      CVPixelBufferCreate(kCFAllocatorDefault, mlTexture.width,
                          mlTexture.height, kCVPixelFormatType_32BGRA,
                          (__bridge CFDictionaryRef)attributes, &pixelBuffer);

  if (status != kCVReturnSuccess) {
    throw createErrorWithMessage(@"Could not create CVPixelBuffer");
  }

  CVMetalTextureRef metalTexture = NULL;
  CVReturn textureStatus = CVMetalTextureCacheCreateTextureFromImage(
      NULL, metalTextureCache, pixelBuffer, NULL, MTLPixelFormatBGRA8Unorm,
      mlTexture.width, mlTexture.height, 0, &metalTexture);

  if (textureStatus != kCVReturnSuccess || metalTexture == NULL) {
    CVPixelBufferRelease(pixelBuffer);
    throw createErrorWithMessage(
        @"Could not create Metal texture from CVPixelBuffer");
  }

  id<MTLTexture> cvTexture = CVMetalTextureGetTexture(metalTexture);

  id<MTLCommandBuffer> commandBuffer = [commandQueue commandBuffer];
  id<MTLBlitCommandEncoder> blitEncoder = [commandBuffer blitCommandEncoder];
  [blitEncoder copyFromTexture:mlTexture
                   sourceSlice:0
                   sourceLevel:0
                  sourceOrigin:MTLOriginMake(0, 0, 0)
                    sourceSize:MTLSizeMake(mlTexture.width, mlTexture.height, 1)
                     toTexture:cvTexture
              destinationSlice:0
              destinationLevel:0
             destinationOrigin:MTLOriginMake(0, 0, 0)];
  [blitEncoder endEncoding];
  [commandBuffer commit];
  [commandBuffer waitUntilCompleted];

  int attempt = 0;
  while (!assetWriterInput.isReadyForMoreMediaData) {
    if (attempt > 100) {
      CVPixelBufferRelease(pixelBuffer);
      CFRelease(metalTexture);
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
  CFRelease(metalTexture);

  if (error) {
    throw error;
  }
}

void VideoEncoderHostObject::finish() {

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

void VideoEncoderHostObject::release() {
  if (assetWriter && assetWriter.status == AVAssetWriterStatusWriting) {
    [assetWriter cancelWriting];
  }
  assetWriter = nullptr;
  assetWriterInput = nullptr;
  commandQueue = nullptr;
  device = nullptr;
}

} // namespace RNSkiaVideo
