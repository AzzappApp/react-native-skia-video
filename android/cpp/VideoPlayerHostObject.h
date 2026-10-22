#pragma once

#include <fbjni/fbjni.h>
#include <jsi/jsi.h>
#include <map>
#include <mutex>

#include "RNSVEventEmitter.h"
#include "VideoPlayer.h"

using namespace facebook;

namespace RNSkiaVideo {

class JSI_EXPORT VideoPlayerHostObject : public jsi::HostObject,
                                         JEventReceiver,
                                         EventEmitter {
public:
  VideoPlayerHostObject(jsi::Runtime& runtime, const std::string& uri,
                        int width, int height, double maxLongSide);
  ~VideoPlayerHostObject();
  jsi::Value get(jsi::Runtime&, const jsi::PropNameID& name) override;
  void set(jsi::Runtime&, const jsi::PropNameID& name,
           const jsi::Value& value) override;
  std::vector<jsi::PropNameID> getPropertyNames(jsi::Runtime& rt) override;
  void handleEvent(std::string eventName, alias_ref<jobject> data) override;

private:
  global_ref<NativeEventDispatcher> jEventDispatcher;
  // Read on the UI thread (decodeNextFrame) and the JS thread, reset by
  // release(): accessed through getPlayer().
  jni::global_ref<VideoPlayer> player;
  std::mutex playerMutex;
  std::atomic_flag released = ATOMIC_FLAG_INIT;
  jni::global_ref<VideoPlayer> getPlayer();
  void release();
};

} // namespace RNSkiaVideo
