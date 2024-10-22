#import "VideoCompositionExporter.h"
#import "VideoComposition.h"
#import "VideoCompositionItemDecoder.h"
#import <AVFoundation/AVFoundation.h>
#import <JsiSkCanvas.h>
#import <React/RCTBridge.h>
#import <SkSurface.h>
#import <SkiaMetalSurfaceFactory.h>
#import <include/gpu/ganesh/mtl/GrMtlBackendSurface.h>
#import <include/gpu/ganesh/GrBackendSurface.h>
#import <include/gpu/ganesh/SkImageGanesh.h>
#import <include/gpu/ganesh/SkSurfaceGanesh.h>
#import <map>

using namespace RNSkia;

NS_INLINE NSError* createErrorWithMessage(NSString* message) {
  return [NSError errorWithDomain:@"com.azzapp.rnskv"
                             code:0
                         userInfo:@{NSLocalizedDescriptionKey : message}];
}

void RNSkiaVideo::exportVideoComposition(
    std::shared_ptr<VideoComposition> composition, std::string outPath,
    int width, int height, int frameRate, int bitRate,
    std::shared_ptr<worklets::WorkletRuntime> workletRuntime,
    std::shared_ptr<worklets::ShareableWorklet> drawFrame,
    std::shared_ptr<RNSkPlatformContext> rnskPlatformContext,
    std::function<void()> onComplete, std::function<void(NSError*)> onError,
    std::function<void(int)> onProgress) {

  NSError* error = nil;
  auto assetWriter = [AVAssetWriter
      assetWriterWithURL:
          [NSURL fileURLWithPath:
                     [NSString
                         stringWithCString:outPath.c_str()
                                  encoding:[NSString defaultCStringEncoding]]]
                fileType:AVFileTypeMPEG4
                   error:&error];
  if (error) {
    onError(error);
    return;
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

  auto assetWriterInput =
      [AVAssetWriterInput assetWriterInputWithMediaType:AVMediaTypeVideo
                                         outputSettings:videoSettings];
  assetWriterInput.expectsMediaDataInRealTime = NO;
  assetWriterInput.performsMultiPassEncodingIfSupported = YES;
  if ([assetWriter canAddInput:assetWriterInput]) {
    [assetWriter addInput:assetWriterInput];
  } else {
    onError(assetWriter.error
                ?: createErrorWithMessage(
                       @"could not add output to asset writter"));
    return;
  }
  [assetWriter startWriting];
  [assetWriter startSessionAtSourceTime:kCMTimeZero];

  std::map<std::string, std::shared_ptr<VideoCompositionItemDecoder>>
      itemDecoders;
  try {
    for (const auto& item : composition->items) {
      itemDecoders[item->id] =
          std::make_shared<VideoCompositionItemDecoder>(item, false);
    }
  } catch (NSError* error) {
    onError(error);
    return;
  } catch (...) {
    onError(createErrorWithMessage(@"Unknown error"));
    return;
  }

  auto surface = SkiaMetalSurfaceFactory::makeOffscreenSurface(width, height);
  id<MTLDevice> device = MTLCreateSystemDefaultDevice();
  id<MTLCommandQueue> commandQueue = [device newCommandQueue];

  int nbFrame = composition->duration * frameRate;
  auto runtime = &workletRuntime->getJSIRuntime();
  auto skCanvas = jsi::Object::createFromHostObject(
      *runtime,
      std::make_shared<JsiSkCanvas>(rnskPlatformContext, surface->getCanvas()));

  std::map<std::string, std::shared_ptr<VideoFrame>> currentFrames;
  auto releaseResources = [&]() {
    for (const auto& entry : itemDecoders) {
      auto decoder = entry.second;
      if (decoder) {
        decoder->release();
      }
    }
    itemDecoders.clear();
    for (const auto& entry : currentFrames) {
      auto frame = entry.second;
      if (frame) {
        frame->release();
      }
    }
    currentFrames.clear();
  };
  for (int i = 0; i < nbFrame; i++) {
    CMTime currentTime =
        CMTimeMakeWithSeconds((double)i / (double)frameRate, NSEC_PER_SEC);
    auto frames = jsi::Object(*runtime);
    for (const auto& entry : itemDecoders) {
      auto itemId = entry.first;
      auto decoder = entry.second;

      decoder->advanceDecoder(currentTime);

      auto previousFrame = currentFrames[itemId];
      auto frame = decoder->acquireFrameForTime(currentTime, !previousFrame);
      if (frame) {
        if (previousFrame) {
          previousFrame->release();
        }
        currentFrames[itemId] = frame;
      } else {
        frame = previousFrame;
      }
      if (frame) {
        frames.setProperty(*runtime, entry.first.c_str(),
                           jsi::Object::createFromHostObject(*runtime, frame));
      }
    }
    surface->getCanvas()->clear(SkColors::kTransparent);
    workletRuntime->runGuarded(drawFrame, skCanvas,
                               CMTimeGetSeconds(currentTime), frames);

    GrAsDirectContext(surface->recordingContext())->flushAndSubmit();
    // Surface seems not initialized on first frame, waiting 1 milliseconds
    if (i == 0) {
      usleep(1000);
    }
    GrBackendTexture texture = SkSurfaces::GetBackendTexture(
        surface.get(), SkSurfaces::BackendHandleAccess::kFlushRead);
    if (!texture.isValid()) {
      releaseResources();
      onError(
          createErrorWithMessage(@"Could not extract texture from SkSurface"));
      return;
    }

    GrMtlTextureInfo textureInfo;
    if (!GrBackendTextures::GetMtlTextureInfo(texture, &textureInfo)) {
      releaseResources();
      onError(
          createErrorWithMessage(@"Could not extract texture from SkSurface"));
      return;
    }

    id<MTLTexture> mlTexture =
        (__bridge id<MTLTexture>)(textureInfo.fTexture.get());

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

    id<MTLCommandBuffer> commandBuffer = [commandQueue commandBufferWithUnretainedReferences];
    id<MTLBlitCommandEncoder> blitEncoder = [commandBuffer blitCommandEncoder];
    [blitEncoder
          copyFromTexture:mlTexture
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
      (NSString*)
      kCVPixelBufferPixelFormatTypeKey : @(kCVPixelFormatType_32BGRA),
      (NSString*)kCVPixelBufferWidthKey : @(width),
      (NSString*)kCVPixelBufferHeightKey : @(height),
      (NSString*)kCVPixelBufferMetalCompatibilityKey : @YES,
    };
    CVReturn status = CVPixelBufferCreate(
        kCFAllocatorDefault, width, height, kCVPixelFormatType_32BGRA,
        (__bridge CFDictionaryRef)attributes, &pixelBuffer);

    if (status != kCVReturnSuccess) {
      releaseResources();
      onError(createErrorWithMessage(@"Could not extract pixels from frame"));
      return;
    }
    CVPixelBufferLockBaseAddress(pixelBuffer, 0);
    void* pixelBufferBytes = CVPixelBufferGetBaseAddress(pixelBuffer);
    if (pixelBufferBytes == NULL) {
      releaseResources();
      onError(createErrorWithMessage(@"Could not extract pixels from frame"));
      return;
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
        releaseResources();
        CVPixelBufferRelease(pixelBuffer);
        [cpuAccessibleTexture setPurgeableState:MTLPurgeableStateEmpty];
        onError(createErrorWithMessage(@"AVAssetWriter unavailable"));
        return;
      }
      attempt++;
      usleep(5000);
    }

    CMSampleBufferRef sampleBuffer = NULL;
    CMVideoFormatDescriptionRef formatDescription = NULL;
    CMVideoFormatDescriptionCreateForImageBuffer(NULL, pixelBuffer,
                                                 &formatDescription);
    CMSampleTimingInfo timingInfo = {.presentationTimeStamp = currentTime,
                                     .decodeTimeStamp = kCMTimeInvalid};

    NSError* error;
    if (CMSampleBufferCreateForImageBuffer(kCFAllocatorDefault, pixelBuffer,
                                           true, NULL, NULL, formatDescription,
                                           &timingInfo, &sampleBuffer) != 0) {
      error =
          createErrorWithMessage(@"Could not create image buffer from frame");
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
      releaseResources();
      onError(error);
      return;
    }
    onProgress(i);
  }

  releaseResources();
  [assetWriter finishWritingWithCompletionHandler:^{
    if (assetWriter.status == AVAssetWriterStatusFailed) {
      onError(assetWriter.error);
      return;
    }
    onComplete();
  }];
}
