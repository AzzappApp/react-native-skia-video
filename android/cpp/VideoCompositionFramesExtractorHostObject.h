#pragma once

#include "VideoCompositionFramesExtractor.h"
#include <EGL/egl.h>
#include <GLES2/gl2.h>
#include <GLES2/gl2ext.h>
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
  ~VideoCompositionFramesExtractorHostObject();
  jsi::Value get(jsi::Runtime&, const jsi::PropNameID& name) override;
  void set(jsi::Runtime&, const jsi::PropNameID& name,
           const jsi::Value& value) override;
  std::vector<jsi::PropNameID> getPropertyNames(jsi::Runtime& rt) override;
  void handleEvent(std::string eventName, alias_ref<jobject> data) override;

private:
  global_ref<NativeEventDispatcher> jEventDispatcher;
  global_ref<VideoCompositionFramesExtractor> player;
  std::atomic_flag released;
  void release();
};

} // namespace RNSkiaVideo
