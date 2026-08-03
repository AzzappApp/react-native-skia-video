#import "VideoEncoderHostObject.h"
#import "AudioCompositionUtils.h"
#import "JsiUtils.h"
#import <Metal/Metal.h>
#import <future>

NS_INLINE NSError* createErrorWithMessage(NSString* message) {
  return [NSError errorWithDomain:@"com.azzapp.rnskv"
                             code:0
                         userInfo:@{NSLocalizedDescriptionKey : message}];
}

namespace RNSkiaVideo {

VideoEncoderHostObject::VideoEncoderHostObject(
    std::string outPath, int width, int height, int frameRate, int bitRate,
    int audioBitRate, int audioSampleRate, int audioChannelCount,
    std::shared_ptr<VideoComposition> composition) {
  this->outPath = outPath;
  this->width = width;
  this->height = height;
  this->frameRate = frameRate;
  this->bitRate = bitRate;
  this->audioBitRate = audioBitRate;
  this->audioSampleRate = audioSampleRate;
  this->audioChannelCount = audioChannelCount;
  this->composition = composition;
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
        ?: createErrorWithMessage(@"could not add output to asset writer");
    return;
  }

  if (composition && composition->hasAudio()) {
    setupAudio();
  }

  [assetWriter startWriting];
  [assetWriter startSessionAtSourceTime:kCMTimeZero];

  if (audioWriterInput) {
    startWritingAudio();
  }

  device = MTLCreateSystemDefaultDevice();
  commandQueue = [device newCommandQueue];

  NSDictionary* attributes = @{
    (NSString*)kCVPixelBufferPixelFormatTypeKey : @(kCVPixelFormatType_32BGRA),
    (NSString*)kCVPixelBufferWidthKey : @(width),
    (NSString*)kCVPixelBufferHeightKey : @(height),
    (NSString*)kCVPixelBufferMetalCompatibilityKey : @YES,
  };
  // Allocate a fresh buffer per frame from this pool instead of reusing a
  // single CVPixelBuffer. AVAssetWriter encodes appended buffers
  // asynchronously, so a reused buffer could be overwritten by the next frame
  // while the encoder is still reading it, producing torn frames on fast
  // motion. The pool only recycles a buffer once every reference to it (the
  // encoder's included) is gone.
  if (pixelBufferPool) {
    CVPixelBufferPoolRelease(pixelBufferPool);
    pixelBufferPool = NULL;
  }
  CVReturn status = CVPixelBufferPoolCreate(
      kCFAllocatorDefault, NULL, (__bridge CFDictionaryRef)attributes,
      &pixelBufferPool);

  if (status != kCVReturnSuccess) {
    throw createErrorWithMessage(@"Could not create pixel buffer pool");
    return;
  }

  MTLTextureDescriptor* descriptor = [MTLTextureDescriptor
      texture2DDescriptorWithPixelFormat:MTLPixelFormatBGRA8Unorm
                                   width:width
                                  height:height
                               mipmapped:NO];
  descriptor.storageMode = MTLStorageModeShared;
  descriptor.pixelFormat = MTLPixelFormatBGRA8Unorm;
  cpuAccessibleTexture = [device newTextureWithDescriptor:descriptor];
}

void VideoEncoderHostObject::encodeFrame(id<MTLTexture> mlTexture,
                                         CMTime time) {
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

  // Vend a fresh buffer from the pool for every frame so the bytes we write
  // below can never be overwritten while a previous frame is still being
  // encoded.
  CVPixelBufferRef pixelBuffer = NULL;
  CVReturn status = CVPixelBufferPoolCreatePixelBuffer(
      kCFAllocatorDefault, pixelBufferPool, &pixelBuffer);
  if (status != kCVReturnSuccess || pixelBuffer == NULL) {
    throw createErrorWithMessage(@"Could not allocate pixel buffer from pool");
  }

  CVPixelBufferLockBaseAddress(pixelBuffer, 0);
  void* pixelBufferBytes = CVPixelBufferGetBaseAddress(pixelBuffer);
  if (pixelBufferBytes == NULL) {
    CVPixelBufferUnlockBaseAddress(pixelBuffer, 0);
    CVPixelBufferRelease(pixelBuffer);
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

  NSError* error = nil;
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
  if (error) {
    throw error;
  }
}

void VideoEncoderHostObject::setupAudio() {
  auto audioComposition = buildAudioComposition(composition, nil);
  if (!audioComposition.composition) {
    return;
  }

  NSError* error = nil;
  audioReader = [AVAssetReader assetReaderWithAsset:audioComposition.composition
                                              error:&error];
  if (error) {
    throw error;
  }
  // The audio composition is padded with silence past the composition
  // duration, clamp the export to the exact video duration.
  audioReader.timeRange = CMTimeRangeMake(
      kCMTimeZero, CMTimeMakeWithSeconds(composition->duration, NSEC_PER_SEC));

  NSDictionary* pcmSettings = @{
    AVFormatIDKey : @(kAudioFormatLinearPCM),
    AVSampleRateKey : @(audioSampleRate),
    AVNumberOfChannelsKey : @(audioChannelCount),
    AVLinearPCMBitDepthKey : @(16),
    AVLinearPCMIsFloatKey : @(NO),
    AVLinearPCMIsBigEndianKey : @(NO),
    AVLinearPCMIsNonInterleaved : @(NO)
  };
  audioMixOutput = [[AVAssetReaderAudioMixOutput alloc]
      initWithAudioTracks:[audioComposition.composition
                              tracksWithMediaType:AVMediaTypeAudio]
            audioSettings:pcmSettings];
  if (audioComposition.audioMix) {
    audioMixOutput.audioMix = audioComposition.audioMix;
  }
  if (![audioReader canAddOutput:audioMixOutput]) {
    throw createErrorWithMessage(@"Could not read composition audio");
  }
  [audioReader addOutput:audioMixOutput];

  NSDictionary* aacSettings = @{
    AVFormatIDKey : @(kAudioFormatMPEG4AAC),
    AVSampleRateKey : @(audioSampleRate),
    AVNumberOfChannelsKey : @(audioChannelCount),
    AVEncoderBitRateKey : @(audioBitRate)
  };
  audioWriterInput =
      [AVAssetWriterInput assetWriterInputWithMediaType:AVMediaTypeAudio
                                         outputSettings:aacSettings];
  audioWriterInput.expectsMediaDataInRealTime = NO;
  if ([assetWriter canAddInput:audioWriterInput]) {
    [assetWriter addInput:audioWriterInput];
  } else {
    audioWriterInput = nil;
    throw assetWriter.error
        ?: createErrorWithMessage(
               @"could not add audio output to asset writer");
  }
}

void VideoEncoderHostObject::startWritingAudio() {
  if (![audioReader startReading]) {
    throw audioReader.error
        ?: createErrorWithMessage(@"Could not read composition audio");
  }
  audioCompletionSemaphore = dispatch_semaphore_create(0);
  audioErrorHolder = [NSMutableArray array];
  dispatch_queue_attr_t attr = dispatch_queue_attr_make_with_qos_class(
      DISPATCH_QUEUE_SERIAL, QOS_CLASS_UTILITY, 0);
  audioQueue = dispatch_queue_create("RNSkiaVideoAudioEncoder", attr);

  // The block only captures ObjC objects, never `this`, so it can safely
  // outlive this host object.
  AVAssetWriterInput* input = audioWriterInput;
  AVAssetReaderAudioMixOutput* output = audioMixOutput;
  AVAssetReader* reader = audioReader;
  AVAssetWriter* writer = assetWriter;
  dispatch_semaphore_t semaphore = audioCompletionSemaphore;
  NSMutableArray<NSError*>* errorHolder = audioErrorHolder;
  __block BOOL finished = NO;
  [input
      requestMediaDataWhenReadyOnQueue:audioQueue
                            usingBlock:^{
                              if (finished) {
                                return;
                              }
                              while (input.isReadyForMoreMediaData) {
                                CMSampleBufferRef sampleBuffer =
                                    [output copyNextSampleBuffer];
                                if (!sampleBuffer) {
                                  if (reader.status ==
                                      AVAssetReaderStatusFailed) {
                                    [errorHolder
                                        addObject:reader.error
                                                      ?: createErrorWithMessage(
                                                             @"Could not read "
                                                             @"composition "
                                                             @"audio")];
                                  }
                                  finished = YES;
                                  [input markAsFinished];
                                  dispatch_semaphore_signal(semaphore);
                                  return;
                                }
                                BOOL appended =
                                    [input appendSampleBuffer:sampleBuffer];
                                CFRelease(sampleBuffer);
                                if (!appended) {
                                  [errorHolder
                                      addObject:writer.error
                                                    ?: createErrorWithMessage(
                                                           @"Could not append "
                                                           @"audio data to "
                                                           @"AVAssetWriter")];
                                  [reader cancelReading];
                                  finished = YES;
                                  [input markAsFinished];
                                  dispatch_semaphore_signal(semaphore);
                                  return;
                                }
                              }
                            }];
}

void VideoEncoderHostObject::finish() {
  // The video input must be marked as finished BEFORE waiting for the
  // audio: AVAssetWriter interleaves the two tracks and would keep the
  // audio input not-ready while waiting for more video data (deadlock).
  [assetWriterInput markAsFinished];
  if (audioWriterInput) {
    dispatch_semaphore_wait(audioCompletionSemaphore, DISPATCH_TIME_FOREVER);
    NSError* audioError = audioErrorHolder.firstObject;
    if (audioError) {
      throw audioError;
    }
  }

  __block std::promise<void> promise;
  std::future<void> future = promise.get_future();
  __block NSError* error = nil;
  [assetWriter finishWritingWithCompletionHandler:^{
    if (assetWriter.status == AVAssetWriterStatusFailed) {
      error = assetWriter.error ?: createErrorWithMessage(@"Failed to export");
    }
    promise.set_value();
  }];

  future.wait();
  if (error != nil) {
    throw error;
  }
}

void VideoEncoderHostObject::release() {
  if (audioReader && audioReader.status == AVAssetReaderStatusReading) {
    [audioReader cancelReading];
  }
  if (audioQueue) {
    // Wait for any in-flight audio block before tearing down the writer.
    dispatch_sync(audioQueue, ^{
                  });
    audioQueue = nil;
  }
  audioReader = nil;
  audioMixOutput = nil;
  audioWriterInput = nil;
  if (assetWriter && assetWriter.status == AVAssetWriterStatusWriting) {
    [assetWriter cancelWriting];
  }
  assetWriter = nil;
  assetWriterInput = nil;
  if (pixelBufferPool) {
    CVPixelBufferPoolRelease(pixelBufferPool);
    pixelBufferPool = NULL;
  }
  if (cpuAccessibleTexture) {
    [cpuAccessibleTexture setPurgeableState:MTLPurgeableStateEmpty];
  }
  cpuAccessibleTexture = nil;
  commandQueue = nil;
  device = nil;
}

} // namespace RNSkiaVideo
