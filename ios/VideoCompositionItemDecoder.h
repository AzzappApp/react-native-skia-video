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
                              bool realTime, AVURLAsset* sharedAsset = nil,
                              CMTime initialTime = kCMTimeZero);
  ~VideoCompositionItemDecoder();
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
  std::list<std::pair<double, CMSampleBufferRef>> decodedFrames;
  std::list<std::pair<double, CMSampleBufferRef>> nextLoopFrames;
  CMTime lastRequestedTime = kCMTimeInvalid;
  std::shared_ptr<VideoFrame> currentFrame;
  // Bounds the lifetime of the frames handed to JS in direct mode; never
  // depends on the JS garbage collector (see VideoFrame.h). Unused in copy
  // mode, where the frames own nothing.
  VideoFrameRing frameRing;
  // Copy mode (the default): every decoded frame is copied into this one
  // texture, which the decoder owns for its whole life.
  bool directTexture = false;
  id<MTLTexture> persistentTexture;

  void setupReader(CMTime initialTime);
  std::shared_ptr<VideoFrame> makeFrame(CVPixelBufferRef buffer);
};

} // namespace RNSkiaVideo
