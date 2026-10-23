#pragma once

#include "RNSVEventEmitter.h"
#include <fbjni/fbjni.h>
#include <jsi/jsi.h>

namespace RNSkiaVideo {
using namespace facebook;
using namespace jni;

class JEventReceiver {
public:
  virtual void handleEvent(std::string eventName, alias_ref<jobject> data) = 0;
};

struct NativeEventDispatcher : public JavaClass<NativeEventDispatcher> {
  static constexpr auto kJavaDescriptor =
      "Lcom/azzapp/rnskv/NativeEventDispatcher;";

  static jni::local_ref<NativeEventDispatcher>
  create(const JEventReceiver* receiver);

  static void registerNatives();

  // Stops the dispatch of events to the receiver, before it is destroyed.
  void invalidate();

  static void dispatchEvent(alias_ref<JClass>, jlong receiver,
                            std::string eventName, alias_ref<jobject> data);
};
} // namespace RNSkiaVideo
