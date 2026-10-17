#pragma once

#import "VideoComposition.h"
#import "VideoFrame.h"
#import <AVFoundation/AVFoundation.h>
#import <list>
#import <mutex>

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
  // Guards the two frame lists below, `hasLooped` (which one the decoder
  // fills) and `lastRequestedTime`. advanceDecoder appends to the lists on
  // its own thread (std::async, see the frames extractor) while
  // acquireFrameForTime erases from them and swaps them on the thread that
  // draws: a std::list mutated from both at once corrupts.
  //
  // Not `lock`: advanceDecoder holds it for its whole decoding pass, and
  // taking it in acquireFrameForTime would park the drawing thread behind a
  // copyNextSampleBuffer loop. Sections under this one are short, nothing is
  // decoded inside them. Lock order: `lock`, then `framesMutex`;
  // acquireFrameForTime takes `framesMutex` alone.
  std::mutex framesMutex;
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

  void setupReader(CMTime initialTime);
  // Releases both frame lists. Callers hold `framesMutex`.
  void releaseFrames();
  double mapSourceTimeToTarget(CMTime sourceTime);
};

} // namespace RNSkiaVideo
