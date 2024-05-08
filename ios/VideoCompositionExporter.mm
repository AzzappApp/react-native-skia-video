#import "VideoCompositionExporter.h"
#import "VideoComposition.h"
#import "VideoCompositionItemDecoder.h"
#import <AVFoundation/AVFoundation.h>
#import <JsiSkCanvas.h>
#import <React/RCTBridge.h>
#import <SkSurface.h>
#import <SkiaMetalSurfaceFactory.h>
#import <include/gpu/GrBackendSurface.h>
#import <include/gpu/ganesh/SkImageGanesh.h>
#import <include/gpu/ganesh/SkSurfaceGanesh.h>
#import <map>

using namespace RNSkia;


NS_INLINE NSError* createErrorWithMessage(NSString *message) {
  return [NSError errorWithDomain:@"com.azzapp.rnskv" code:0 userInfo:@{
    NSLocalizedDescriptionKey: message
  }];
}

void RNSkiaVideo::exportVideoComposition(
    VideoComposition* composition, std::string outPath, int width, int height,
    int frameRate, int bitRate,
    std::shared_ptr<reanimated::WorkletRuntime> workletRuntime,
    std::shared_ptr<reanimated::ShareableWorklet> drawFrame,
    std::shared_ptr<RNSkPlatformContext> rnskPlatformContext,
    std::function<void()> onComplete, std::function<void(NSError *)> onError) {

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
    NSError* error = assetWriter.error ?: createErrorWithMessage(@"could not add output to asset writter");
    onError(assetWriter.error);
    return;
  }
  [assetWriter startWriting];
  [assetWriter startSessionAtSourceTime:kCMTimeZero];

  std::map<std::string, VideoCompositionItemDecoder*> itemDecoders;
  try {
    for (const auto item : composition->items) {
      itemDecoders[item->id] = new VideoCompositionItemDecoder(item);
    }
  } catch (NSError* error) {
    onError(error);
    return;
  } catch(...) {
    onError(createErrorWithMessage(@"Unknown error"));
    return;
  }
  auto surface = SkiaMetalSurfaceFactory::makeOffscreenSurface(width, height);
  id<MTLDevice> device = MTLCreateSystemDefaultDevice();
  id<MTLCommandQueue> commandQueue = [device newCommandQueue];

  int nbFrame = composition->duration * frameRate;
  auto runtime = &workletRuntime->getJSIRuntime();
  
  auto releaseResource = [&] () {
    try {
      for (const auto& entry : itemDecoders) {
        entry.second->release();
      }
    } catch(...) {}
  };
  
  
  for (int i = 0; i < nbFrame; i++) {
    CMTime currentTime =
        CMTimeMakeWithSeconds((double)i / (double)frameRate, NSEC_PER_SEC);
    auto frames = jsi::Object(*runtime);
    for (const auto& entry : itemDecoders) {
      auto decoder = entry.second;
      decoder->advance(currentTime);
      auto frame = jsi::Object(*runtime);

      auto buffer = decoder->getCurrentBuffer();
      auto dimensions = decoder->getFramesDimensions();
      if (buffer) {
        frame.setProperty(*runtime, "width", jsi::Value(dimensions.width));
        frame.setProperty(*runtime, "height", jsi::Value(dimensions.height));
        frame.setProperty(*runtime, "rotation",
                          jsi::Value(dimensions.rotation));
        frame.setProperty(*runtime, "buffer",
                          jsi::BigInt::fromUint64(
                              *runtime, reinterpret_cast<uintptr_t>(buffer)));
        frames.setProperty(*runtime, entry.first.c_str(), frame);
      }
    }
    surface->getCanvas()->clear(SkColors::kTransparent);
    auto skCanvas = jsi::Object::createFromHostObject(
        *runtime, std::make_shared<JsiSkCanvas>(rnskPlatformContext,
                                                surface->getCanvas()));
    workletRuntime->runGuarded(drawFrame, skCanvas,
                               CMTimeGetSeconds(currentTime), frames);
                               
    GrAsDirectContext(surface->recordingContext())->flushAndSubmit();
    GrBackendTexture texture = SkSurfaces::GetBackendTexture(
                surface.get(), SkSurfaces::BackendHandleAccess::kFlushRead);
    if (!texture.isValid()) {
      releaseResource();
      onError(createErrorWithMessage(@"Could not extract texture from SkSurface"));
      return;
    }

    GrMtlTextureInfo textureInfo;
    if (!texture.getMtlTextureInfo(&textureInfo)) {
      releaseResource();
      onError(createErrorWithMessage(@"Could not extract texture from SkSurface"));
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

    id<MTLCommandBuffer> commandBuffer = [commandQueue commandBuffer];
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

    // Step 1
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
      releaseResource();
      onError(createErrorWithMessage(@"Could not extract pixels from frame"));
      return;
    }
    CVPixelBufferLockBaseAddress(pixelBuffer, 0);
    void* pixelBufferBytes = CVPixelBufferGetBaseAddress(pixelBuffer);
    if (pixelBufferBytes == NULL) {
      releaseResource();
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

    while (!assetWriterInput.isReadyForMoreMediaData) {
      usleep(10);
    }

    CMSampleBufferRef sampleBuffer = NULL;
    CMVideoFormatDescriptionRef formatDescription = NULL;
    CMVideoFormatDescriptionCreateForImageBuffer(NULL, pixelBuffer,
                                                 &formatDescription);
    CMSampleTimingInfo timingInfo = {.presentationTimeStamp = currentTime,
                                     .decodeTimeStamp = kCMTimeInvalid};

    if (CMSampleBufferCreateForImageBuffer(kCFAllocatorDefault, pixelBuffer,
                                           true, NULL, NULL, formatDescription,
                                           &timingInfo, &sampleBuffer) != 0) {
      
      
      if (formatDescription) {
        CFRelease(formatDescription);
      }
      CVBufferRelease(pixelBuffer);
      releaseResource();
      onError(createErrorWithMessage(@"Could not create image buffer from frame"));
      return;
    }

    if (sampleBuffer) {
      if (![assetWriterInput appendSampleBuffer:sampleBuffer]) {
        if (assetWriter.status == AVAssetWriterStatusFailed) {
          if (formatDescription) {
            CFRelease(formatDescription);
          }
          CVBufferRelease(pixelBuffer);
          CFRelease(sampleBuffer);
          releaseResource();
          onError(assetWriter.error);
          return;
        }
      }
      CFRelease(sampleBuffer);
    } else {
      if (formatDescription) {
        CFRelease(formatDescription);
      }
      CVBufferRelease(pixelBuffer);
      releaseResource();
      onError(createErrorWithMessage(@"Failed to create sampleBuffer"));
      return;
    }
    CFRelease(sampleBuffer);
    if (formatDescription) {
      CFRelease(formatDescription);
    }
    CVBufferRelease(pixelBuffer);
  }
  
  releaseResource();
  [assetWriter finishWritingWithCompletionHandler:^{
    onComplete();
  }];
}

