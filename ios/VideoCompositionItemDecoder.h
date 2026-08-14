#pragma once

#import "VideoComposition.h"
#import "VideoFrame.h"
#import <AVFoundation/AVFoundation.h>
#import <list>

using namespace facebook;

namespace RNSkiaVideo {

class VideoCompositionItemDecoder {
public:
  VideoCompositionItemDecoder(std::shared_ptr<VideoCompositionItem> item,
                              bool realTime, AVURLAsset* sharedAsset = nil);
  void advanceDecoder(CMTime currentTime);
  void seekTo(CMTime currentTime);
  std::shared_ptr<VideoFrame> acquireFrameForTime(CMTime currentTime,
                                                  bool force);
  void release();

private:
  NSObject* lock;
  bool realTime = false;
  bool hasLooped = false;
  std::shared_ptr<VideoCompositionItem> item;
  double width;
  double height;
  int rotation;
  AVURLAsset* asset;
  AVAssetTrack* videoTrack;
  NSArray<AVAssetTrackSegment*>* segments;
  AVAssetReader* assetReader;
  std::list<std::pair<double, CMSampleBufferRef>> decodedFrames;
  std::list<std::pair<double, CMSampleBufferRef>> nextLoopFrames;
  CMTime lastRequestedTime = kCMTimeInvalid;
  std::shared_ptr<VideoFrame> currentFrame;
  // Recently issued frames and retired frames awaiting surface idleness;
  // lifetime never depends on the JS garbage collector (see VideoFrame.h).
  std::list<std::shared_ptr<VideoFrame>> issuedFrames;
  std::list<std::shared_ptr<VideoFrame>> retiredFrames;

  void setupReader(CMTime initialTime);
  double mapSourceTimeToTarget(CMTime sourceTime);
};

} // namespace RNSkiaVideo
