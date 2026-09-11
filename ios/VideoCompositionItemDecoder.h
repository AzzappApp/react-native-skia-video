#pragma once

#import "VideoComposition.h"
#import "VideoFrame.h"
#import <AVFoundation/AVFoundation.h>
#import <deque>
#import <list>

using namespace facebook;

namespace RNSkiaVideo {

class VideoCompositionItemDecoder {
public:
  VideoCompositionItemDecoder(std::shared_ptr<VideoCompositionItem> item,
                              bool realTime, AVURLAsset* sharedAsset = nil);
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
  NSArray<AVAssetTrackSegment*>* segments;
  AVAssetReader* assetReader;
  // Copy mode: the persistent texture every frame is copied into.
  id<MTLTexture> mtlTexture;
  // Direct mode: frames wrap the decoder's pixel buffers; the last few stay
  // alive here so an image still being drawn survives the next decodes.
  bool directTexture = false;
  std::deque<std::shared_ptr<VideoFrame>> directFrames;
  std::list<std::pair<double, CMSampleBufferRef>> decodedFrames;
  std::list<std::pair<double, CMSampleBufferRef>> nextLoopFrames;
  CMTime lastRequestedTime = kCMTimeInvalid;
  std::shared_ptr<VideoFrame> currentFrame;

  void setupReader(CMTime initialTime);
  double mapSourceTimeToTarget(CMTime sourceTime);
  void ensurePersistentTexture();
  std::shared_ptr<VideoFrame> makeFrame(CVPixelBufferRef buffer);
};

} // namespace RNSkiaVideo
