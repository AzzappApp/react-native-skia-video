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
      EventEmitter {
public:
  VideoCompositionFramesExtractorHostObject(jsi::Runtime& runtime, jsi::Object);
  ~VideoCompositionFramesExtractorHostObject();
  jsi::Value get(jsi::Runtime&, const jsi::PropNameID& name) override;
  void set(jsi::Runtime&, const jsi::PropNameID& name,
           const jsi::Value& value) override;
  std::vector<jsi::PropNameID> getPropertyNames(jsi::Runtime& rt) override;

private:
  bool released = false;
  JEventBridge* eventBridge;
  global_ref<VideoCompositionFramesExtractor> player;
  std::map<std::string, std::shared_ptr<facebook::jsi::Function>> jsListeners;
  void release();
};

} // namespace RNSkiaVideo
