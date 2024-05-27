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
                              bool realTime);
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
  AVAssetReader* assetReader;
  std::list<std::pair<double, std::shared_ptr<VideoFrame>>> decodedFrames;
  std::list<std::pair<double, std::shared_ptr<VideoFrame>>> nextLoopFrames;
  CMTime lastRequestedTime = kCMTimeInvalid;
  std::shared_ptr<VideoFrame> currentFrame;

  void setupReader(CMTime initialTime);
};

} // namespace RNSkiaVideo
