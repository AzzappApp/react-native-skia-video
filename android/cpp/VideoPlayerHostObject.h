#pragma once

#include <fbjni/fbjni.h>
#include <jsi/jsi.h>
#include <map>

#include "EventEmitter.h"
#include "VideoPlayer.h"

using namespace facebook;

namespace RNSkiaVideo {

class JSI_EXPORT VideoPlayerHostObject : public jsi::HostObject,
                                         JEventReceiver,
                                         EventEmitter {
public:
  VideoPlayerHostObject(jsi::Runtime& runtime, const std::string& uri,
                        int width, int height);
  ~VideoPlayerHostObject();
  jsi::Value get(jsi::Runtime&, const jsi::PropNameID& name) override;
  void set(jsi::Runtime&, const jsi::PropNameID& name,
           const jsi::Value& value) override;
  std::vector<jsi::PropNameID> getPropertyNames(jsi::Runtime& rt) override;
  void handleEvent(std::string eventName, alias_ref<jobject> data) override;

private:
  global_ref<NativeEventDispatcher> jEventDispatcher;
  jni::global_ref<VideoPlayer> player;
  std::atomic_flag released = ATOMIC_FLAG_INIT;
  void release();
};

} // namespace RNSkiaVideo
