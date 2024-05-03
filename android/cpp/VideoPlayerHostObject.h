#pragma once

#include <fbjni/fbjni.h>
#include <jsi/jsi.h>
#include <map>

#include "EventEmitter.h"
#include "JSIJNIConversion.h"
#include "VideoPlayer.h"

using namespace facebook;

namespace RNSkiaVideo {

class JSI_EXPORT VideoPlayerHostObject : public jsi::HostObject, EventEmitter {
public:
  VideoPlayerHostObject(jsi::Runtime& runtime, const std::string& uri);
  ~VideoPlayerHostObject();
  jsi::Value get(jsi::Runtime&, const jsi::PropNameID& name) override;
  void set(jsi::Runtime&, const jsi::PropNameID& name,
           const jsi::Value& value) override;
  std::vector<jsi::PropNameID> getPropertyNames(jsi::Runtime& rt) override;

private:
  JEventBridge* eventBridge;
  jni::global_ref<VideoPlayer> player;
  bool released = false;
  void release();
};

} // namespace RNSkiaVideo
