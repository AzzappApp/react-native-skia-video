#import "VideoEncoderHostObject.h"
#import "AudioCompositionUtils.h"
#import "RNSVJSIUtils.h"
#import "RNSVPixelData.h"
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
  result.push_back(jsi::PropNameID::forUtf8(rt, std::string("beginFrame")));
  result.push_back(jsi::PropNameID::forUtf8(rt, std::string("endFrame")));
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
          return runPooled([&] { prepare(); });
        });
  }
  if (propName == "encodeFrame") {
    return jsi::Function::createFromHostFunction(
        runtime, jsi::PropNameID::forAscii(runtime, "encodeFrame"), 2,
        [this](jsi::Runtime& runtime, const jsi::Value& thisValue,
               const jsi::Value* arguments, size_t count) -> jsi::Value {
          if (count < 2 || !arguments[1].isNumber()) {
            throw jsi::JSError(runtime,
                               "VideoEncoder.encodeFrame(..) expects pixels "
                               "(Uint8Array) and a time (number)!");
          }
          auto pixels = getPixelData(runtime, arguments[0],
                                     "VideoEncoder.encodeFrame(..)");
          auto time =
              CMTimeMakeWithSeconds(arguments[1].asNumber(), NSEC_PER_SEC);

          return runPooled(
              [&] { encodeFrame(pixels.data, pixels.size, time); });
        });
  }
  if (propName == "beginFrame") {
    return jsi::Function::createFromHostFunction(
        runtime, jsi::PropNameID::forAscii(runtime, "beginFrame"), 0,
        [this](jsi::Runtime& runtime, const jsi::Value& thisValue,
               const jsi::Value* arguments, size_t count) -> jsi::Value {
          IOSurfaceRef surface = NULL;
          runPooled([&] { surface = beginFrame(); });
          return jsi::BigInt::fromUint64(runtime,
                                         reinterpret_cast<uintptr_t>(surface));
        });
  }
  if (propName == "endFrame") {
    return jsi::Function::createFromHostFunction(
        runtime, jsi::PropNameID::forAscii(runtime, "endFrame"), 1,
        [this](jsi::Runtime& runtime, const jsi::Value& thisValue,
               const jsi::Value* arguments, size_t count) -> jsi::Value {
          if (count < 1 || !arguments[0].isNumber()) {
            throw jsi::JSError(runtime, "VideoEncoder.endFrame(..) expects a "
                                        "time (number)!");
          }
          auto time =
              CMTimeMakeWithSeconds(arguments[0].asNumber(), NSEC_PER_SEC);
          return runPooled([&] { endFrame(time); });
        });
  }
  if (propName == "finishWriting") {
    return jsi::Function::createFromHostFunction(
        runtime, jsi::PropNameID::forAscii(runtime, "finishWriting"), 0,
        [this](jsi::Runtime& runtime, const jsi::Value& thisValue,
               const jsi::Value* arguments, size_t count) -> jsi::Value {
          return runPooled([&] { finish(); });
        });
  } else if (propName == "dispose") {
    return jsi::Function::createFromHostFunction(
        runtime, jsi::PropNameID::forAscii(runtime, "dispose"), 0,
        [this](jsi::Runtime& runtime, const jsi::Value& thisValue,
               const jsi::Value* arguments, size_t count) -> jsi::Value {
          return runPooled([&] { this->release(); });
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
  assetWriterInput.performsMultiPassEncodingIfSupported = NO;
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

  NSDictionary* attributes = @{
    (NSString*)kCVPixelBufferPixelFormatTypeKey : @(kCVPixelFormatType_32BGRA),
    (NSString*)kCVPixelBufferWidthKey : @(width),
    (NSString*)kCVPixelBufferHeightKey : @(height),
    (NSString*)kCVPixelBufferIOSurfacePropertiesKey : @{},
    (NSString*)kCVPixelBufferMetalCompatibilityKey : @YES,
  };
  // Allocate a fresh buffer per frame from this pool instead of reusing a
  // single CVPixelBuffer. AVAssetWriter encodes appended buffers
  // asynchronously, so a reused buffer could be overwritten by the next frame
  // while the encoder is still reading it, producing torn frames on fast
  // motion. The pool only recycles a buffer once every reference to it (the
  // encoder's included) is gone, which also keeps the memory used bounded.
  if (pixelBufferPool) {
    CVPixelBufferPoolRelease(pixelBufferPool);
    pixelBufferPool = NULL;
  }
  CVReturn status = CVPixelBufferPoolCreate(
      kCFAllocatorDefault, NULL, (__bridge CFDictionaryRef)attributes,
      &pixelBufferPool);
  if (status != kCVReturnSuccess) {
    throw createErrorWithMessage(@"Could not create pixel buffer pool");
  }
}

CVPixelBufferRef VideoEncoderHostObject::createFrameBuffer() {
  CVPixelBufferRef pixelBuffer = NULL;
  CVReturn status = CVPixelBufferPoolCreatePixelBuffer(
      kCFAllocatorDefault, pixelBufferPool, &pixelBuffer);
  if (status != kCVReturnSuccess || pixelBuffer == NULL) {
    throw createErrorWithMessage(@"Could not allocate pixel buffer from pool");
  }
  return pixelBuffer;
}

void VideoEncoderHostObject::appendFrameBuffer(CVPixelBufferRef pixelBuffer,
                                               CMTime time) {
  int attempt = 0;
  while (!assetWriterInput.isReadyForMoreMediaData) {
    if (attempt > 100) {
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
  } else if (!error) {
    error = createErrorWithMessage(@"Failed to create sampleBuffer");
  }
  if (formatDescription) {
    CFRelease(formatDescription);
  };
  if (error) {
    throw error;
  }
}

void VideoEncoderHostObject::encodeFrame(const uint8_t* pixels, size_t size,
                                         CMTime time) {
  const size_t srcBytesPerRow = (size_t)width * 4;
  if (size < srcBytesPerRow * height) {
    throw createErrorWithMessage(
        @"The frame dimensions do not match the export dimensions");
  }

  CVPixelBufferRef pixelBuffer = createFrameBuffer();
  CVPixelBufferLockBaseAddress(pixelBuffer, 0);
  uint8_t* dst = (uint8_t*)CVPixelBufferGetBaseAddress(pixelBuffer);
  if (dst == NULL) {
    CVPixelBufferUnlockBaseAddress(pixelBuffer, 0);
    CVPixelBufferRelease(pixelBuffer);
    throw createErrorWithMessage(@"Could not write the frame pixels");
  }
  // The pixel buffer rows may be padded.
  const size_t dstBytesPerRow = CVPixelBufferGetBytesPerRow(pixelBuffer);
  if (dstBytesPerRow == srcBytesPerRow) {
    memcpy(dst, pixels, srcBytesPerRow * height);
  } else {
    for (int y = 0; y < height; y++) {
      memcpy(dst + y * dstBytesPerRow, pixels + y * srcBytesPerRow,
             srcBytesPerRow);
    }
  }
  CVPixelBufferUnlockBaseAddress(pixelBuffer, 0);

  try {
    appendFrameBuffer(pixelBuffer, time);
  } catch (...) {
    CVPixelBufferRelease(pixelBuffer);
    throw;
  }
  CVPixelBufferRelease(pixelBuffer);
}

IOSurfaceRef VideoEncoderHostObject::beginFrame() {
  releasePendingFrameBuffer();
  pendingFrameBuffer = createFrameBuffer();
  IOSurfaceRef surface = CVPixelBufferGetIOSurface(pendingFrameBuffer);
  if (surface == NULL) {
    releasePendingFrameBuffer();
    throw createErrorWithMessage(@"The frame buffer has no IOSurface");
  }
  return surface;
}

void VideoEncoderHostObject::endFrame(CMTime time) {
  if (pendingFrameBuffer == NULL) {
    throw createErrorWithMessage(@"endFrame called without beginFrame");
  }
  try {
    appendFrameBuffer(pendingFrameBuffer, time);
  } catch (...) {
    releasePendingFrameBuffer();
    throw;
  }
  releasePendingFrameBuffer();
}

void VideoEncoderHostObject::releasePendingFrameBuffer() {
  if (pendingFrameBuffer) {
    CVPixelBufferRelease(pendingFrameBuffer);
    pendingFrameBuffer = NULL;
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
    AVAssetWriterInput* input = audioWriterInput;
    BOOL shouldMarkFinished =
        input && (assetWriter.status == AVAssetWriterStatusWriting ||
                  assetWriter.status == AVAssetWriterStatusFailed);
    dispatch_sync(audioQueue, ^{
      if (shouldMarkFinished) {
        [input markAsFinished];
      }
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
  releasePendingFrameBuffer();
  if (pixelBufferPool) {
    CVPixelBufferPoolRelease(pixelBufferPool);
    pixelBufferPool = NULL;
  }
}

} // namespace RNSkiaVideo
