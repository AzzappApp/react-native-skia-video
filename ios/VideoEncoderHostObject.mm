#import "VideoEncoderHostObject.h"
#import "AudioCompositionUtils.h"
#import "RNSVJSIUtils.h"
#import <algorithm>

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

// An export that never called dispose() (its runtime torn down mid-export):
// the writer, the audio reading and the pools are released all the same.
VideoEncoderHostObject::~VideoEncoderHostObject() {
  @autoreleasepool {
    release();
  }
}

std::vector<jsi::PropNameID>
VideoEncoderHostObject::getPropertyNames(jsi::Runtime& rt) {
  std::vector<jsi::PropNameID> result;
  result.push_back(jsi::PropNameID::forUtf8(rt, std::string("prepare")));
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
    },
    // The NV12 frames of endFrame() are converted and tagged with these (see
    // convertFrameBuffer()): the encoder takes them as they are.
    AVVideoColorPropertiesKey : @{
      AVVideoColorPrimariesKey : AVVideoColorPrimaries_ITU_R_709_2,
      AVVideoTransferFunctionKey : AVVideoTransferFunction_ITU_R_709_2,
      AVVideoYCbCrMatrixKey : AVVideoYCbCrMatrix_ITU_R_709_2,
    },
  };

  assetWriterInput =
      [AVAssetWriterInput assetWriterInputWithMediaType:AVMediaTypeVideo
                                         outputSettings:videoSettings];
  // Not real time: the encoder works at its own pace, the export waits for
  // it. Its memory is bounded by the NV12 buffers it can hold at once (see
  // createEncoderBuffer()): AVAssetWriter alone kept about 55 frames ahead.
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

  if (![assetWriter startWriting]) {
    throw assetWriter.error
        ?: createErrorWithMessage(@"Could not start writing the video");
  }
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
  // Each appended frame is a fresh buffer of a pool, never a reused
  // CVPixelBuffer. AVAssetWriter encodes appended buffers asynchronously, so a
  // reused buffer could be overwritten by the next frame while the encoder is
  // still reading it, producing torn frames on fast motion. A pool only
  // recycles a buffer once every reference to it (the encoder's included) is
  // gone, which also keeps the memory used bounded.
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

  // NV12, the encoder's own input format: a 1080x1920 frame is 3.1 MB
  // instead of 8.3 MB in BGRA, and the encoder holds several of them (see
  // createEncoderBuffer()).
  NSDictionary* encoderAttributes = @{
    (NSString*)kCVPixelBufferPixelFormatTypeKey :
        @(kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange),
    (NSString*)kCVPixelBufferWidthKey : @(width),
    (NSString*)kCVPixelBufferHeightKey : @(height),
    (NSString*)kCVPixelBufferIOSurfacePropertiesKey : @{},
  };
  if (encoderBufferPool) {
    CVPixelBufferPoolRelease(encoderBufferPool);
    encoderBufferPool = NULL;
  }
  status = CVPixelBufferPoolCreate(kCFAllocatorDefault, NULL,
                                   (__bridge CFDictionaryRef)encoderAttributes,
                                   &encoderBufferPool);
  if (status != kCVReturnSuccess) {
    throw createErrorWithMessage(@"Could not create pixel buffer pool");
  }
  if (pixelTransferSession == NULL) {
    VTPixelTransferSessionRef session = NULL;
    if (VTPixelTransferSessionCreate(kCFAllocatorDefault, &session) != noErr) {
      throw createErrorWithMessage(@"Could not create pixel transfer session");
    }
    VTSessionSetProperty(session,
                         kVTPixelTransferPropertyKey_DestinationYCbCrMatrix,
                         kCVImageBufferYCbCrMatrix_ITU_R_709_2);
    pixelTransferSession = session;
  }
}

CVPixelBufferRef
VideoEncoderHostObject::createPoolBuffer(CVPixelBufferPoolRef pool) {
  CVPixelBufferRef pixelBuffer = NULL;
  CVReturn status = CVPixelBufferPoolCreatePixelBuffer(kCFAllocatorDefault,
                                                       pool, &pixelBuffer);
  if (status != kCVReturnSuccess || pixelBuffer == NULL) {
    throw createErrorWithMessage(@"Could not allocate pixel buffer from pool");
  }
  return pixelBuffer;
}

// The NV12 buffers the encoder can hold at once: enough for it to encode a
// frame while the next ones are drawn, few enough to bound its memory (25 MB
// at 1080×1920, 100 MB in 4K).
static const int MAX_ENCODER_BUFFERS = 8;

CVPixelBufferRef VideoEncoderHostObject::createEncoderBuffer() {
  NSDictionary* auxAttributes = @{
    (NSString*)kCVPixelBufferPoolAllocationThresholdKey : @(MAX_ENCODER_BUFFERS)
  };
  const CFAbsoluteTime deadline = CFAbsoluteTimeGetCurrent() + 10;
  while (true) {
    CVPixelBufferRef pixelBuffer = NULL;
    CVReturn status = CVPixelBufferPoolCreatePixelBufferWithAuxAttributes(
        kCFAllocatorDefault, encoderBufferPool,
        (__bridge CFDictionaryRef)auxAttributes, &pixelBuffer);
    if (status == kCVReturnSuccess && pixelBuffer != NULL) {
      return pixelBuffer;
    }
    if (status != kCVReturnWouldExceedAllocationThreshold) {
      throw createErrorWithMessage(
          @"Could not allocate pixel buffer from pool");
    }
    // The encoder holds every buffer: wait for it to be done with one.
    if (assetWriter.status == AVAssetWriterStatusFailed) {
      throw assetWriter.error
          ?: createErrorWithMessage(@"AVAssetWriter failed");
    }
    if (CFAbsoluteTimeGetCurrent() > deadline) {
      throw createErrorWithMessage(
          @"The encoder held its buffers for more than 10 seconds");
    }
    usleep(1000);
  }
}

void VideoEncoderHostObject::appendFrameBuffer(CVPixelBufferRef pixelBuffer,
                                               CMTime time) {
  // The encoder can fall behind for a while (large frames, a hot device):
  // only give up if it fails or stays unavailable for long.
  const CFAbsoluteTime deadline = CFAbsoluteTimeGetCurrent() + 10;
  while (!assetWriterInput.isReadyForMoreMediaData) {
    if (assetWriter.status == AVAssetWriterStatusFailed) {
      throw assetWriter.error
          ?: createErrorWithMessage(@"AVAssetWriter failed");
    }
    if (CFAbsoluteTimeGetCurrent() > deadline) {
      throw createErrorWithMessage(
          @"AVAssetWriter unavailable for more than 10 seconds");
    }
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

// Converts the BGRA frame drawn into to NV12, the format the encoder
// converts it to anyway, with VideoToolbox's hardware. The source carries no
// color tags, so only the BT.709 matrix is applied (no color matching); the
// result is then tagged BT.709, like the video (see prepare()).
void VideoEncoderHostObject::convertFrameBuffer(CVPixelBufferRef source,
                                                CVPixelBufferRef destination) {
  // A recycled buffer of the pool may keep the tags of its previous frame.
  CVBufferRemoveAllAttachments(destination);
  OSStatus status = VTPixelTransferSessionTransferImage(pixelTransferSession,
                                                        source, destination);
  if (status != noErr) {
    throw createErrorWithMessage([NSString
        stringWithFormat:@"Could not convert the frame (%d)", (int)status]);
  }
  CVBufferSetAttachment(destination, kCVImageBufferYCbCrMatrixKey,
                        kCVImageBufferYCbCrMatrix_ITU_R_709_2,
                        kCVAttachmentMode_ShouldPropagate);
  CVBufferSetAttachment(destination, kCVImageBufferColorPrimariesKey,
                        kCVImageBufferColorPrimaries_ITU_R_709_2,
                        kCVAttachmentMode_ShouldPropagate);
  CVBufferSetAttachment(destination, kCVImageBufferTransferFunctionKey,
                        kCVImageBufferTransferFunction_ITU_R_709_2,
                        kCVAttachmentMode_ShouldPropagate);
}

IOSurfaceRef VideoEncoderHostObject::beginFrame() {
  // The same buffer every frame: JS imports it into Skia's device once (an
  // imported IOSurface stays in use until its JS object is garbage
  // collected). It is never appended (see endFrame()), so it can be drawn
  // into again as soon as a frame has ended.
  if (frameBuffer == NULL) {
    frameBuffer = createPoolBuffer(pixelBufferPool);
  }
  IOSurfaceRef surface = CVPixelBufferGetIOSurface(frameBuffer);
  if (surface == NULL) {
    throw createErrorWithMessage(@"The frame buffer has no IOSurface");
  }
  framePending = true;
  return surface;
}

void VideoEncoderHostObject::endFrame(CMTime time) {
  if (!framePending) {
    throw createErrorWithMessage(@"endFrame called without beginFrame");
  }
  framePending = false;
  // The buffer drawn into is not appended itself. AVAssetWriter releases a
  // buffer while the video encoder, out of process on a device, still reads
  // its IOSurface, and nothing in this process tells when it is done: the
  // IOSurface's use count is per process.
  // Handed out again, the buffer was drawn into while being encoded, and the
  // export showed the next frame in place of this one (that frame lost), or
  // a cleared one. The frame is converted into a fresh NV12 buffer of a pool
  // instead (see convertFrameBuffer()): a pool recycles a buffer only once its
  // IOSurface is used by no process. One conversion, no GPU readback.
  CVPixelBufferRef pixelBuffer = createEncoderBuffer();
  try {
    convertFrameBuffer(frameBuffer, pixelBuffer);
    appendFrameBuffer(pixelBuffer, time);
  } catch (...) {
    CVPixelBufferRelease(pixelBuffer);
    throw;
  }
  CVPixelBufferRelease(pixelBuffer);
}

void VideoEncoderHostObject::releaseFrameBuffer() {
  if (frameBuffer) {
    CVPixelBufferRelease(frameBuffer);
    frameBuffer = NULL;
  }
  framePending = false;
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
  // Bounded waits: a stalled writer fails the export instead of blocking the
  // export thread forever.
  auto timeout = [] {
    return dispatch_time(DISPATCH_TIME_NOW, 30 * NSEC_PER_SEC);
  };
  if (audioWriterInput) {
    if (dispatch_semaphore_wait(audioCompletionSemaphore, timeout()) != 0) {
      throw createErrorWithMessage(@"Could not write the audio in 30 seconds");
    }
    NSError* audioError = audioErrorHolder.firstObject;
    if (audioError) {
      throw audioError;
    }
  }

  // The handler only captures the semaphore: it can run after a timeout.
  dispatch_semaphore_t finished = dispatch_semaphore_create(0);
  [assetWriter finishWritingWithCompletionHandler:^{
    dispatch_semaphore_signal(finished);
  }];
  if (dispatch_semaphore_wait(finished, timeout()) != 0) {
    throw createErrorWithMessage(@"Could not finish the video in 30 seconds");
  }
  if (assetWriter.status == AVAssetWriterStatusFailed) {
    throw assetWriter.error ?: createErrorWithMessage(@"Failed to export");
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
  releaseFrameBuffer();
  if (pixelBufferPool) {
    CVPixelBufferPoolRelease(pixelBufferPool);
    pixelBufferPool = NULL;
  }
  if (encoderBufferPool) {
    CVPixelBufferPoolRelease(encoderBufferPool);
    encoderBufferPool = NULL;
  }
  if (pixelTransferSession) {
    VTPixelTransferSessionInvalidate(pixelTransferSession);
    CFRelease(pixelTransferSession);
    pixelTransferSession = NULL;
  }
}

} // namespace RNSkiaVideo
