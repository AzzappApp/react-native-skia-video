#pragma once

#import "EventEmitter.h"
#import "VideoComposition.h"
#import "VideoCompositionItemDecoder.h"
#import <AVFoundation/AVFoundation.h>
#import <jsi/jsi.h>
#import <map>

namespace RNSkiaVideo {
using namespace facebook;

class JSI_EXPORT VideoCompositionFramesExtractorHostObject
    : public jsi::HostObject,
      EventEmitter {
public:
  VideoCompositionFramesExtractorHostObject(
      jsi::Runtime& runtime, std::shared_ptr<react::CallInvoker> callInvoker,
      jsi::Object composition);
  ~VideoCompositionFramesExtractorHostObject();
  jsi::Value get(jsi::Runtime&, const jsi::PropNameID& name) override;
  void set(jsi::Runtime&, const jsi::PropNameID& name,
           const jsi::Value& value) override;
  std::vector<jsi::PropNameID> getPropertyNames(jsi::Runtime& rt) override;

private:
  std::shared_ptr<VideoComposition> composition;
  std::map<std::string, std::shared_ptr<VideoCompositionItemDecoder>> itemDecoders;
  NSDate* startDate;
  CMTime pausePosition = kCMTimeZero;
  bool playWhenReady = false;
  bool isPlaying = false;
  bool isLooping = false;
  bool initialized = false;
  std::atomic_flag released = false;

  void init();
  void play();
  void pause();
  void seekTo(CMTime time);
  CMTime getCurrentTime();
  void release();
};

} // namespace RNSkiaVideo
