#include "VideoCompositionItemDecoder.h"

#import "AVAssetTrackUtils.h"
#import <AVFoundation/AVFoundation.h>
#import <Foundation/Foundation.h>

namespace RNSkiaVideo {

VideoCompositionItemDecoder::VideoCompositionItemDecoder(
    std::shared_ptr<VideoCompositionItem> item, bool realTime,
    AVURLAsset* sharedAsset) {
  this->item = item;
  this->realTime = realTime;
  lock = [[NSObject alloc] init];
  NSString* path =
      [NSString stringWithCString:item->path.c_str()
                         encoding:[NSString defaultCStringEncoding]];
  asset = sharedAsset
              ?: [AVURLAsset URLAssetWithURL:[NSURL fileURLWithPath:path]
                                     options:nil];
  videoTrack = [[asset tracksWithMediaType:AVMediaTypeVideo] firstObject];
  if (!videoTrack) {
    throw [NSError
        errorWithDomain:@"com.azzapp.rnskv"
                   code:0
               userInfo:@{
                 NSLocalizedDescriptionKey : [NSString
                     stringWithFormat:@"No video track for path: %@", path]
               }];
  }
  segments = videoTrack.segments;
  width = videoTrack.naturalSize.width;
  height = videoTrack.naturalSize.height;
  rotation = AVAssetTrackUtils::GetTrackRotationInDegree(videoTrack);
  currentFrame = nullptr;
  // The reader is set up by advanceDecoder, while the item is live.
}

void VideoCompositionItemDecoder::setupReader(CMTime initialTime) {
  NSError* error = nil;
  assetReader = [AVAssetReader assetReaderWithAsset:asset error:&error];
  if (error) {
    throw error;
  }

  auto startTime = CMTimeMakeWithSeconds(item->startTime, NSEC_PER_SEC);
  auto position = CMTimeMakeWithSeconds(
      MAX((CMTimeGetSeconds(initialTime) - item->compositionStartTime), 0),
      NSEC_PER_SEC);
  assetReader.timeRange = CMTimeRangeMake(
      CMTimeAdd(startTime, position),
      CMTimeSubtract(CMTimeMakeWithSeconds(item->duration, NSEC_PER_SEC),
                     position));

  // NV12 is the decoder's native output: requesting BGRA would make
  // VideoToolbox convert every frame. The YUV to RGB conversion happens on the
  // GPU when the frame is drawn into a texture (React Native WebGPU's
  // importExternalTexture), which needs IOSurface-backed buffers. The frames
  // are SDR BT.709, HDR video (an iPhone's HLG) tone mapped by VideoToolbox:
  // the GPU conversion applies the BT.709 matrix only (see frameImages.ts).
  NSDictionary* pixBuffAttributes = @{
    (id)kCVPixelBufferPixelFormatTypeKey :
        @(kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange),
    (id)kCVPixelBufferIOSurfacePropertiesKey : @{},
    (id)kCVPixelBufferMetalCompatibilityKey : @YES,
    AVVideoColorPropertiesKey : @{
      AVVideoColorPrimariesKey : AVVideoColorPrimaries_ITU_R_709_2,
      AVVideoTransferFunctionKey : AVVideoTransferFunction_ITU_R_709_2,
      AVVideoYCbCrMatrixKey : AVVideoYCbCrMatrix_ITU_R_709_2,
    },
  };
  CGSize resolution = item->resolution;
  if ((resolution.width <= 0 || resolution.height <= 0) &&
      item->maxLongSide > 0) {
    // Resolved HERE and nowhere else: `naturalSize` is the file's encoded
    // frame, and the output settings below are read in that same orientation.
    // A caller capping the size itself would have to pass encoded dimensions,
    // the ones it cannot know, since every API hands it display dimensions
    // (a portrait phone clip is a 1920x1080 file with a 90° transform). Ask
    // it for the long side and there is nothing left to get wrong.
    CGSize natural = videoTrack.naturalSize;
    double longSide = MAX(natural.width, natural.height);
    if (longSide > item->maxLongSide) {
      // Even sizes: the frames are 4:2:0, their chroma planes half the size.
      double scale = item->maxLongSide / longSide;
      resolution = CGSizeMake(MAX(2, 2 * round(natural.width * scale / 2)),
                              MAX(2, 2 * round(natural.height * scale / 2)));
    }
  }
  if (resolution.width > 0 && resolution.height > 0) {
    pixBuffAttributes =
        [NSMutableDictionary dictionaryWithDictionary:pixBuffAttributes];
    [pixBuffAttributes setValue:@(resolution.width)
                         forKey:(id)kCVPixelBufferWidthKey];
    [pixBuffAttributes setValue:@(resolution.height)
                         forKey:(id)kCVPixelBufferHeightKey];
    width = resolution.width;
    height = resolution.height;
  }

  AVAssetReaderOutput* assetReaderOutput =
      [[AVAssetReaderTrackOutput alloc] initWithTrack:videoTrack
                                       outputSettings:pixBuffAttributes];
  // The decoded buffers are handed to the GPU as is, never modified: no need
  // for the reader to copy them.
  assetReaderOutput.alwaysCopiesSampleData = NO;
  [assetReader addOutput:assetReaderOutput];
  [assetReader startReading];
}

// Slow-motion videos (e.g. those recorded by the iPhone camera) store every
// frame in the short *source* (media) timeline but expose a stretched
// presentation duration through the track's segment time mappings. The raw
// AVAssetReaderTrackOutput hands us samples with their source timestamps and
// ignores those mappings, so we remap each sample into the *target*
// (presentation) timeline that the composition uses. For regular videos the
// single segment is an identity mapping and this is a no-op.
double VideoCompositionItemDecoder::mapSourceTimeToTarget(CMTime sourceTime) {
  if (segments == nil || segments.count == 0) {
    return CMTimeGetSeconds(sourceTime);
  }
  AVAssetTrackSegment* matching = nil;
  for (AVAssetTrackSegment* segment in segments) {
    if (segment.empty) {
      continue;
    }
    CMTimeRange source = segment.timeMapping.source;
    if (!CMTIMERANGE_IS_VALID(source) || source.duration.value == 0) {
      continue;
    }
    if (CMTimeCompare(sourceTime, source.start) >= 0) {
      // Keep the latest segment starting at or before the sample so that
      // samples falling past a segment's end extrapolate from the nearest
      // mapping instead of desyncing back to an identity timeline.
      matching = segment;
      if (CMTimeCompare(sourceTime, CMTimeRangeGetEnd(source)) < 0) {
        break;
      }
    } else if (matching == nil) {
      matching = segment;
      break;
    }
  }
  if (matching == nil) {
    return CMTimeGetSeconds(sourceTime);
  }
  CMTime target = CMTimeMapTimeFromRangeToRange(
      sourceTime, matching.timeMapping.source, matching.timeMapping.target);
  return CMTimeGetSeconds(target);
}

#define DECODER_INPUT_TIME_ADVANCE 0.1

void VideoCompositionItemDecoder::advanceDecoder(
    CMTime currentTime, std::optional<uint64_t> expectedGeneration) {
  @synchronized(lock) {
    if (expectedGeneration && *expectedGeneration != generation) {
      return;
    }
    CMTime startTime = CMTimeMakeWithSeconds(item->startTime, NSEC_PER_SEC);
    CMTime compositionStartTime =
        CMTimeMakeWithSeconds(item->compositionStartTime, NSEC_PER_SEC);
    CMTime position =
        CMTimeAdd(startTime, CMTimeSubtract(currentTime, compositionStartTime));
    CMTime inputPosition =
        realTime
            ? CMTimeAdd(position, CMTimeMakeWithSeconds(
                                      DECODER_INPUT_TIME_ADVANCE, NSEC_PER_SEC))
            : position;
    CMTime duration = CMTimeMakeWithSeconds(item->duration, NSEC_PER_SEC);
    CMTime endTime = CMTimeAdd(startTime, duration);

    // Opened where the composition is: on its first call, after a seek or
    // once the item is live again (see release).
    if (assetReader == nil) {
      if (openFailed) {
        return;
      }
      try {
        setupReader(currentTime);
      } catch (...) {
        // Reported once, not with every frame.
        openFailed = true;
        throw;
      }
    }

    bool looped;
    {
      std::lock_guard<std::mutex> frames(framesMutex);
      looped = hasLooped;
    }
    if (realTime && CMTimeCompare(endTime, inputPosition) < 0 && !looped) {
      setupReader(kCMTimeZero);
      {
        std::lock_guard<std::mutex> frames(framesMutex);
        hasLooped = true;
      }
      // we will loop so we want to decode the first frames of the next loop
      inputPosition =
          CMTimeAdd(position, CMTimeMakeWithSeconds(DECODER_INPUT_TIME_ADVANCE,
                                                    NSEC_PER_SEC));
    }

    CMTime latestSampleTime = kCMTimeInvalid;
    {
      std::lock_guard<std::mutex> frames(framesMutex);
      auto framesQueue = hasLooped ? &nextLoopFrames : &decodedFrames;
      if (framesQueue->size() > 0) {
        latestSampleTime =
            CMTimeMakeWithSeconds(framesQueue->back().first, NSEC_PER_SEC);
      }
    }

    bool recovered = false;
    while (!CMTIME_IS_VALID(latestSampleTime) ||
           (CMTimeCompare(latestSampleTime, inputPosition) < 0 &&
            CMTimeCompare(endTime, inputPosition) >= 0)) {
      if (assetReader.status != AVAssetReaderStatusReading) {
        // An AVAssetReader interrupted by the system (app sent to the
        // background, media services reset) ends up Failed and never delivers
        // a frame again: the composition clock keeps running and the video
        // stays frozen. Rebuild it once, where the reader that died was (the
        // start of the next loop if it was decoding it ahead, otherwise the
        // current composition time), and keep decoding.
        if (!recovered &&
            (assetReader == nil ||
             assetReader.status == AVAssetReaderStatusFailed ||
             assetReader.status == AVAssetReaderStatusCancelled)) {
          recovered = true;
          bool aheadOfLoop;
          {
            std::lock_guard<std::mutex> frames(framesMutex);
            aheadOfLoop = hasLooped;
          }
          try {
            setupReader(aheadOfLoop ? kCMTimeZero : currentTime);
          } catch (...) {
            break;
          }
          continue;
        }
        break;
      }
      AVAssetReaderOutput* assetReaderOutput =
          [assetReader.outputs firstObject];
      CMSampleBufferRef sampleBuffer = [assetReaderOutput copyNextSampleBuffer];
      if (!sampleBuffer) {
        break;
      }
      if (CMSampleBufferGetNumSamples(sampleBuffer) == 0) {
        CFRelease(sampleBuffer);
        continue;
      }
      auto timeStamp = CMSampleBufferGetPresentationTimeStamp(sampleBuffer);
      double targetSeconds = this->mapSourceTimeToTarget(timeStamp);
      auto buffer = CMSampleBufferGetImageBuffer(sampleBuffer);
      if (buffer) {
        // The list is picked again for each frame: acquireFrameForTime may
        // have promoted the next loop's frames in between, and a frame
        // appended to the list it just emptied would never be shown.
        std::lock_guard<std::mutex> frames(framesMutex);
        auto framesQueue = hasLooped ? &nextLoopFrames : &decodedFrames;
        framesQueue->push_back(std::make_pair(targetSeconds, sampleBuffer));
      } else {
        CFRelease(sampleBuffer);
      }

      latestSampleTime = CMTimeMakeWithSeconds(targetSeconds, NSEC_PER_SEC);
    }
  }
}

std::shared_ptr<VideoFrame>
VideoCompositionItemDecoder::acquireFrameForTime(CMTime currentTime,
                                                 bool force) {
  CMTime position = CMTimeAdd(
      CMTimeMakeWithSeconds(item->startTime, NSEC_PER_SEC),
      CMTimeMakeWithSeconds(
          MAX((CMTimeGetSeconds(currentTime) - item->compositionStartTime), 0),
          NSEC_PER_SEC));

  CMSampleBufferRef nextFrame = nil;
  {
    std::lock_guard<std::mutex> frames(framesMutex);
    if (hasLooped && CMTIME_IS_VALID(lastRequestedTime) &&
        CMTimeCompare(currentTime, lastRequestedTime) < 0) {
      hasLooped = false;
      for (const auto& frame : decodedFrames) {
        CFRelease(frame.second);
      }
      decodedFrames = std::move(nextLoopFrames);
      nextLoopFrames.clear();
    }
    lastRequestedTime = currentTime;

    auto it = decodedFrames.begin();
    while (it != decodedFrames.end()) {
      auto timestamp = CMTimeMakeWithSeconds(it->first, NSEC_PER_SEC);
      if (CMTimeCompare(timestamp, position) <= 0 ||
          (force && nextFrame == nullptr)) {
        if (nextFrame != nullptr) {
          CFRelease(nextFrame);
        }
        nextFrame = it->second;
        it = decodedFrames.erase(it);
      } else {
        break;
      }
    }
  }
  if (nextFrame) {
    // The frame retains the decoded buffer itself (no copy).
    auto frame = std::make_shared<VideoFrame>(
        CMSampleBufferGetImageBuffer(nextFrame), width, height, rotation);
    CFRelease(nextFrame);
    return frame;
  }
  return nullptr;
}

void VideoCompositionItemDecoder::seekTo(CMTime currentTime) {
  @synchronized(lock) {
    // advanceDecoder sets the reader up again, at the time it decodes.
    release();
    openFailed = false;
  }
}

void VideoCompositionItemDecoder::release() {
  @synchronized(lock) {
    generation++;
    if (assetReader) {
      [assetReader cancelReading];
      assetReader = nullptr;
    }
    {
      std::lock_guard<std::mutex> frames(framesMutex);
      releaseFrames();
      hasLooped = false;
      lastRequestedTime = kCMTimeInvalid;
    }
    currentFrame = nullptr;
  }
}

void VideoCompositionItemDecoder::releaseFrames() {
  for (const auto& frame : decodedFrames) {
    CFRelease(frame.second);
  }
  decodedFrames.clear();
  for (const auto& frame : nextLoopFrames) {
    CFRelease(frame.second);
  }
  nextLoopFrames.clear();
}

VideoCompositionItemDecoder::~VideoCompositionItemDecoder() {
  // The decoded frames are retained sample buffers: ARC doesn't release them.
  std::lock_guard<std::mutex> frames(framesMutex);
  releaseFrames();
}

} // namespace RNSkiaVideo
