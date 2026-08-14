#pragma once

#include "RNSVEventEmitter.h"
#include "RNSVVideoPlayer.h"
#include "VideoFrame.h"
#include <list>

using namespace facebook;

@interface RNSVSkiaVideoPlayerDelegateImpl : NSObject <RNSVVideoPlayerDelegate>

- (instancetype)initWithHost:(RNSkiaVideo::EventEmitter*)host
                     runtime:(jsi::Runtime*)runtime;
- (void)dispose;

@end

namespace RNSkiaVideo {

class JSI_EXPORT VideoPlayerHostObject : public jsi::HostObject, EventEmitter {
public:
  VideoPlayerHostObject(jsi::Runtime& runtime,
                        std::shared_ptr<react::CallInvoker> callInvoker,
                        NSURL* url, CGSize resolution);
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
  // Recently issued frames and retired frames awaiting surface idleness;
  // lifetime never depends on the JS garbage collector (see VideoFrame.h).
  std::list<std::shared_ptr<VideoFrame>> issuedFrames;
  std::list<std::shared_ptr<VideoFrame>> retiredFrames;
  CMTime lastFrameAvailable = kCMTimeInvalid;
  CMTime lastFrameDrawn = kCMTimeInvalid;
  float width;
  float height;
  int rotation;
  std::atomic_flag released = ATOMIC_FLAG_INIT;
  void release();
};
} // namespace RNSkiaVideo
