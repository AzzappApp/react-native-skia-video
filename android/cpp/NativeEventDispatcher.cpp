#include "NativeEventDispatcher.h"

namespace RNSkiaVideo {
using namespace facebook;
using namespace jni;

jni::local_ref<NativeEventDispatcher>
NativeEventDispatcher::create(const RNSkiaVideo::JEventReceiver* receiver) {
  return newInstance((jlong)receiver);
}

void NativeEventDispatcher::registerNatives() {
  javaClassStatic()->registerNatives({makeNativeMethod(
      "nativeDispatchEvent", NativeEventDispatcher::dispatchEvent)});
}

void NativeEventDispatcher::dispatchEvent(alias_ref<JClass>, jlong receiverPtr,
                                          std::string eventName,
                                          alias_ref<jobject> data) {
  auto receiver = reinterpret_cast<JEventReceiver*>(receiverPtr);
  receiver->handleEvent(eventName, data);
}

} // namespace RNSkiaVideo
