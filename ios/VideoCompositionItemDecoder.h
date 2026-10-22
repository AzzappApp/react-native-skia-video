#pragma once

#import "VideoComposition.h"
#import "VideoFrame.h"
#import <AVFoundation/AVFoundation.h>
#import <atomic>
#import <list>
#import <mutex>
#import <optional>

using namespace facebook;

namespace RNSkiaVideo {

class VideoCompositionItemDecoder {
public:
  VideoCompositionItemDecoder(std::shared_ptr<VideoCompositionItem> item,
                              bool realTime, AVURLAsset* sharedAsset = nil);
  ~VideoCompositionItemDecoder();
  // Decodes the frames up to `currentTime`, setting the reader up first if it
  // is not (see release). With `decodeNextLoop`, once the item's end is
  // reached, the reader is set up again at its start and decodes the first
  // frames of the next loop of the composition ahead. With the generation read
  // when it was started (see getGeneration), does nothing if the decoder was
  // released since: a decoding started on another thread before a seek would
  // set the reader up at the position from before the seek, and one started
  // before the composition is released would decode frames that nothing
  // releases.
  void
  advanceDecoder(CMTime currentTime, bool decodeNextLoop = false,
                 std::optional<uint64_t> expectedGeneration = std::nullopt);
  void seekTo(CMTime currentTime);
  std::shared_ptr<VideoFrame> acquireFrameForTime(CMTime currentTime,
                                                  bool force);
  // Releases the reader and the decoded frames: while the item is not live.
  // The next advanceDecoder sets the reader up again.
  void release();
  // Changes with each release, seeks included (see advanceDecoder).
  uint64_t getGeneration() const {
    return generation;
  }
  std::shared_ptr<VideoCompositionItem> getItem() const {
    return item;
  }

private:
  NSObject* lock;
  // Guards the two frame lists below, `hasLooped` (which one the decoder
  // fills) and `lastRequestedTime`. advanceDecoder appends to the lists on
  // a decoding thread (see the frames extractor's decodeFrames) while
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
  // Whether the reader could not be set up: advanceDecoder no longer tries
  // until the next seek.
  bool openFailed = false;
  std::atomic<uint64_t> generation{0};
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
