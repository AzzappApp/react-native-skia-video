#pragma once

#include "EventEmitter.h"
#include "RNSVVideoPlayer.h"
#include "VideoFrame.h"

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
                        NSURL* url);
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
  CMTime lastFrameAvailable = kCMTimeInvalid;
  CMTime lastFrameDrawn = kCMTimeInvalid;
  float width;
  float height;
  int rotation;
  std::atomic_flag released;
  void release();
};
} // namespace RNSkiaVideo
