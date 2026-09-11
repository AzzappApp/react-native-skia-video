#pragma once

#include "RNSVEventEmitter.h"
#include "RNSVHostObject.h"
#include "RNSVVideoPlayer.h"
#include "VideoFrame.h"
#include <deque>

using namespace facebook;

@interface RNSVSkiaVideoPlayerDelegateImpl : NSObject <RNSVVideoPlayerDelegate>

- (instancetype)initWithHost:(RNSkiaVideo::EventEmitter*)host
                     runtime:(jsi::Runtime*)runtime;
- (void)dispose;

@end

namespace RNSkiaVideo {

class JSI_EXPORT VideoPlayerHostObject : public RNSVHostObject, EventEmitter {
public:
  VideoPlayerHostObject(jsi::Runtime& runtime,
                        std::shared_ptr<react::CallInvoker> callInvoker,
                        NSURL* url, CGSize resolution, bool directTexture);
  ~VideoPlayerHostObject();
  jsi::Value get(jsi::Runtime&, const jsi::PropNameID& name) override;
  void set(jsi::Runtime&, const jsi::PropNameID& name,
           const jsi::Value& value) override;
  std::vector<jsi::PropNameID> getPropertyNames(jsi::Runtime& rt) override;

  void readyToPlay(float width, float height, int rotation);
  void frameAvailableEventHandler(CMTime time);

private:
  RNSVVideoPlayer* player;
  RNSVSkiaVideoPlayerDelegateImpl* playerDelegate;
  std::shared_ptr<VideoFrame> currentFrame;
  // Direct texture mode: frames wrap the player's pixel buffers instead of
  // being copied into one persistent texture; the last few stay alive here.
  bool directTexture = false;
  std::deque<std::shared_ptr<VideoFrame>> directFrames;
  CMTime lastFrameAvailable = kCMTimeInvalid;
  CMTime lastFrameDrawn = kCMTimeInvalid;
  float width;
  float height;
  int rotation;
  std::atomic_flag released = ATOMIC_FLAG_INIT;
  std::shared_ptr<VideoFrame> makeDirectFrame(CVPixelBufferRef buffer);
  void release();
};
} // namespace RNSkiaVideo
