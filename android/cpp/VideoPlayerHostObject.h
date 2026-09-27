#pragma once

#include <mutex>

#include <fbjni/fbjni.h>
#include <jsi/jsi.h>
#include <map>

#include "RNSVEventEmitter.h"
#include "RNSVHostObject.h"
#include "SkiaContextHolder.h"
#include "VideoPlayer.h"

using namespace facebook;

namespace RNSkiaVideo {

class JSI_EXPORT VideoPlayerHostObject : public RNSVHostObject,
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
  std::shared_ptr<SkiaContextHolder> skiaContextHolder;
  jni::global_ref<VideoPlayer> player;
  std::atomic_flag released = ATOMIC_FLAG_INIT;
  // Held by every use of `player` and by release(): the UI thread draws
  // while the JS thread disposes, and a use that passed the released check
  // went on with a player release() had just reset.
  std::recursive_mutex playerMutex;
  void release();
};

} // namespace RNSkiaVideo
