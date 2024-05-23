#include "VideoCompositionItemDecoder.h"

#import "AVAssetTrackUtils.h"
#import <AVFoundation/AVFoundation.h>
#import <Foundation/Foundation.h>

namespace RNSkiaVideo {

VideoCompositionItemDecoder::VideoCompositionItemDecoder(
    std::shared_ptr<VideoCompositionItem> item, bool enableLoopMode) {
  this->item = item;
  this->enableLoopMode = enableLoopMode;
  NSString* path =
      [NSString stringWithCString:item->path.c_str()
                         encoding:[NSString defaultCStringEncoding]];
  asset = [AVURLAsset URLAssetWithURL:[NSURL fileURLWithPath:path] options:nil];
  videoTrack = [[asset tracksWithMediaType:AVMediaTypeVideo] objectAtIndex:0];
  width = videoTrack.naturalSize.width;
  height = videoTrack.naturalSize.height;
  rotation = AVAssetTrackUtils::GetTrackRotationInDegree(videoTrack);
  currentFrame = nullptr;
  this->setupReader(kCMTimeZero);
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

  NSDictionary* pixBuffAttributes = @{
    (id)kCVPixelBufferPixelFormatTypeKey :
        @(kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange),
    (id)kCVPixelBufferIOSurfacePropertiesKey : @{},
    (id)kCVPixelBufferMetalCompatibilityKey : @YES
  };

  AVAssetReaderOutput* assetReaderOutput =
      [[AVAssetReaderTrackOutput alloc] initWithTrack:videoTrack
                                       outputSettings:pixBuffAttributes];
  [assetReader addOutput:assetReaderOutput];
  [assetReader startReading];
}

#define DECODER_INPUT_TIME_ADVANCE 0.3

void VideoCompositionItemDecoder::advanceDecoder(CMTime currentTime) {
  CMTime startTime = CMTimeMakeWithSeconds(item->startTime, NSEC_PER_SEC);
  CMTime compositionStartTime =
      CMTimeMakeWithSeconds(item->compositionStartTime, NSEC_PER_SEC);
  CMTime position =
      CMTimeAdd(startTime, CMTimeSubtract(currentTime, compositionStartTime));
  CMTime inputPosition =
      CMTimeAdd(position, CMTimeMakeWithSeconds(DECODER_INPUT_TIME_ADVANCE,
                                                NSEC_PER_SEC));
  CMTime duration = CMTimeMakeWithSeconds(item->duration, NSEC_PER_SEC);
  CMTime endTime = CMTimeAdd(startTime, duration);

  if (enableLoopMode && CMTimeCompare(endTime, inputPosition) < 0 &&
      !hasLooped) {
    setupReader(kCMTimeZero);
    hasLooped = true;
    // we will loop so we want to decode the first frames of the next loop
    inputPosition =
        CMTimeAdd(position, CMTimeMakeWithSeconds(DECODER_INPUT_TIME_ADVANCE,
                                                  NSEC_PER_SEC));
  }

  auto framesQueue = hasLooped ? &nextLoopFrames : &decodedFrames;
  CMTime latestSampleTime = kCMTimeInvalid;
  if (framesQueue->size() > 0) {
    latestSampleTime =
        CMTimeMakeWithSeconds(framesQueue->back().first, NSEC_PER_SEC);
  }

  while (!CMTIME_IS_VALID(latestSampleTime) ||
         (CMTimeCompare(latestSampleTime, inputPosition) < 0 &&
          CMTimeCompare(endTime, inputPosition) >= 0)) {
    AVAssetReaderOutput* assetReaderOutput = [assetReader.outputs firstObject];
    CMSampleBufferRef sampleBuffer = [assetReaderOutput copyNextSampleBuffer];
    if (!sampleBuffer) {
      break;
    }
    if (CMSampleBufferGetNumSamples(sampleBuffer) == 0) {
      CFRelease(sampleBuffer);
      continue;
    }
    auto timeStamp = CMSampleBufferGetPresentationTimeStamp(sampleBuffer);
    auto buffer = CMSampleBufferGetImageBuffer(sampleBuffer);
    auto frame = std::make_shared<VideoFrame>(buffer, width, height, rotation);
    framesQueue->push_back(std::make_pair(CMTimeGetSeconds(timeStamp), frame));
    latestSampleTime = timeStamp;
    CFRelease(sampleBuffer);
  }
}

std::shared_ptr<VideoFrame>
VideoCompositionItemDecoder::acquireFrameForTime(CMTime currentTime,
                                                 bool force) {
  if (hasLooped && CMTIME_IS_VALID(lastRequestedTime) &&
      CMTimeCompare(currentTime, lastRequestedTime) < 0) {
    hasLooped = false;
    for (const auto& frame : decodedFrames) {
      frame.second->release();
    }
    decodedFrames = nextLoopFrames;
    nextLoopFrames.clear();
  }
  lastRequestedTime = currentTime;

  CMTime position = CMTimeAdd(
      CMTimeMakeWithSeconds(item->startTime, NSEC_PER_SEC),
      CMTimeMakeWithSeconds(
          MAX((CMTimeGetSeconds(currentTime) - item->compositionStartTime), 0),
          NSEC_PER_SEC));

  std::shared_ptr<VideoFrame> nextFrame = nullptr;
  auto it = decodedFrames.begin();
  while (it != decodedFrames.end()) {
    auto timestamp = CMTimeMakeWithSeconds(it->first, NSEC_PER_SEC);
    if (CMTimeCompare(timestamp, position) <= 0 ||
        (force && nextFrame == nullptr)) {
      if (nextFrame != nullptr) {
        nextFrame->release();
      }
      nextFrame = it->second;
      it = decodedFrames.erase(it);
    } else {
      break;
    }
  }
  return nextFrame;
}

void VideoCompositionItemDecoder::seekTo(CMTime currentTime) {
  release();
  setupReader(currentTime);
}

void VideoCompositionItemDecoder::release() {
  for (const auto& frame : decodedFrames) {
    frame.second->release();
  }
  decodedFrames.clear();
  for (const auto& frame : nextLoopFrames) {
    frame.second->release();
  }
  if (currentFrame) {
    currentFrame->release();
    currentFrame = nullptr;
  }
  nextLoopFrames.clear();
  hasLooped = false;
  lastRequestedTime = kCMTimeInvalid;
  if (assetReader) {
    [assetReader cancelReading];
  }
}

} // namespace RNSkiaVideo
