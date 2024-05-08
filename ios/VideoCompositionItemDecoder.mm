#include "VideoCompositionItemDecoder.h"

#import "AVAssetTrackUtils.h"
#import <AVFoundation/AVFoundation.h>
#import <Foundation/Foundation.h>

namespace RNSkiaVideo {

VideoCompositionItemDecoder::VideoCompositionItemDecoder(
    std::shared_ptr<VideoCompositionItem> item) {
  this->item = item;

  NSString* path =
      [NSString stringWithCString:item->path.c_str()
                         encoding:[NSString defaultCStringEncoding]];
  asset = [AVURLAsset URLAssetWithURL:[NSURL fileURLWithPath:path] options:nil];
  videoTrack = [[asset tracksWithMediaType:AVMediaTypeVideo] objectAtIndex:0];
  CGFloat width = videoTrack.naturalSize.width;
  CGFloat height = videoTrack.naturalSize.height;
  int rotationDegrees = GetTrackRotationInDegree(videoTrack);

  framesDimensions = {width, height, rotationDegrees};
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
    (id)kCVPixelBufferPixelFormatTypeKey : @(kCVPixelFormatType_32BGRA),
    (id)kCVPixelBufferIOSurfacePropertiesKey : @{},
    (id)kCVPixelBufferMetalCompatibilityKey : @YES
  };

  AVAssetReaderOutput* assetReaderOutput =
      [[AVAssetReaderTrackOutput alloc] initWithTrack:videoTrack
                                       outputSettings:pixBuffAttributes];
  [assetReader addOutput:assetReaderOutput];
  [assetReader startReading];
}

void VideoCompositionItemDecoder::advance(CMTime currentTime) {
  if (assetReader.status == AVAssetReaderStatusUnknown) {
    [assetReader startReading];
  }

  auto hasFrame = currentBuffer != nil;

  CMTime itemPosition = CMTimeSubtract(
      currentTime,
      CMTimeMakeWithSeconds(item->compositionStartTime, NSEC_PER_SEC));

  CMTime latestSampleTime = kCMTimeInvalid;
  if (decodedFrames.size() > 0) {
    latestSampleTime =
        CMTimeMakeWithSeconds(decodedFrames.back().first, NSEC_PER_SEC);
  }

  while (!CMTIME_IS_VALID(latestSampleTime) ||
         CMTimeCompare(latestSampleTime, itemPosition) < 0) {
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
    CVBufferRetain(buffer);
    decodedFrames.push_back(
        std::make_pair(CMTimeGetSeconds(timeStamp), buffer));
    latestSampleTime = timeStamp;
    CFRelease(sampleBuffer);
  }

  CVBufferRef nextBuffer = nullptr;
  auto it = decodedFrames.begin();
  while (it != decodedFrames.end()) {
    auto timestamp = CMTimeMakeWithSeconds(it->first, NSEC_PER_SEC);
    if (CMTimeCompare(timestamp, itemPosition) <= 0 ||
        (!hasFrame && nextBuffer == nullptr)) {
      if (nextBuffer != nullptr) {
        CVBufferRelease(nextBuffer);
      }
      nextBuffer = it->second;
      it = decodedFrames.erase(it);
    } else {
      ++it;
    }
  }
  if (nextBuffer) {
    if (currentBuffer) {
      CVBufferRelease(currentBuffer);
    }
    currentBuffer = nextBuffer;
  }
}

void VideoCompositionItemDecoder::seekTo(CMTime currentTime) {
  for (const auto& frame : decodedFrames) {
    CVBufferRelease(frame.second);
  }
  decodedFrames.clear();
  [assetReader cancelReading];
  setupReader(currentTime);
}

CVPixelBufferRef VideoCompositionItemDecoder::getCurrentBuffer() {
  return currentBuffer;
}

VideoDimensions VideoCompositionItemDecoder::getFramesDimensions() {
  return framesDimensions;
}

void VideoCompositionItemDecoder::release() {
  if (currentBuffer) {
    CVBufferRelease(currentBuffer);
    currentBuffer = nullptr;
  }
  for (const auto& frame : decodedFrames) {
    CVBufferRelease(frame.second);
  }
  decodedFrames.clear();
  if (assetReader) {
    [assetReader cancelReading];
  }
}

} // namespace RNSkiaVideo
