#pragma once

#include "NativeEventDispatcher.h"
#include "SkiaContextHolder.h"
#include "VideoCompositionFramesExtractor.h"
#include <fbjni/fbjni.h>
#include <jsi/jsi.h>
#include <map>

using namespace facebook;

namespace RNSkiaVideo {

class JSI_EXPORT VideoCompositionFramesExtractorHostObject
    : public jsi::HostObject,
      EventEmitter,
      JEventReceiver {
public:
  VideoCompositionFramesExtractorHostObject(jsi::Runtime& runtime, jsi::Object);
  ~VideoCompositionFramesExtractorHostObject() override;
  jsi::Value get(jsi::Runtime&, const jsi::PropNameID& name) override;
  void set(jsi::Runtime&, const jsi::PropNameID& name,
           const jsi::Value& value) override;
  std::vector<jsi::PropNameID> getPropertyNames(jsi::Runtime& rt) override;
  void handleEvent(std::string eventName, alias_ref<jobject> data) override;

private:
  global_ref<NativeEventDispatcher> jEventDispatcher;
  global_ref<VideoCompositionFramesExtractor> player;
  std::shared_ptr<SkiaContextHolder> skiaContextHolder;
  std::atomic_flag prepared = ATOMIC_FLAG_INIT;
  std::atomic_flag released = ATOMIC_FLAG_INIT;
  void release();
};

} // namespace RNSkiaVideo
