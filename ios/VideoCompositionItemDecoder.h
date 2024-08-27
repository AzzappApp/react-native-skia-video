#pragma once

#import "VideoComposition.h"
#import "VideoFrame.h"
#import <AVFoundation/AVFoundation.h>
#import <list>
#import <map>

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

static void decoderPool(
  std::shared_ptr<VideoComposition>& composition,
  std::map<std::string, std::shared_ptr<VideoCompositionItemDecoder>>& itemDecoders,
  std::map<std::string, std::shared_ptr<VideoFrame>>& currentFrames,
  CMTime time,
  bool realTime) {
  for (const auto& item : composition->items) {
    CMTime threshold = CMTimeMakeWithSeconds(0.5, NSEC_PER_SEC);
    CMTime startTime = CMTimeMakeWithSeconds(item->startTime, NSEC_PER_SEC);
    CMTime compositionStartTime = CMTimeMakeWithSeconds(item->compositionStartTime, NSEC_PER_SEC);
    CMTime duration = CMTimeMakeWithSeconds(item->duration, NSEC_PER_SEC);
    CMTime position = CMTimeAdd(startTime, CMTimeSubtract(time, compositionStartTime));
    CMTime endTime = CMTimeAdd(startTime, duration);
    
    bool visible = (CMTimeCompare(CMTimeSubtract(startTime, threshold), position) <= 0 &&
                    CMTimeCompare(CMTimeAdd(endTime, threshold), position) >= 0);
    bool initialized = itemDecoders.count(item->id) > 0;
    if (visible && !initialized) {
      itemDecoders[item->id] = std::make_shared<VideoCompositionItemDecoder>(item, realTime);
    } else if (!visible && initialized) {
      itemDecoders[item->id]->release();
      itemDecoders.erase(item->id);
      if (currentFrames.count(item->id) > 0) {
        currentFrames[item->id]->release();
        currentFrames.erase(item->id);
      }
    }
  }
}

} // namespace RNSkiaVideo
