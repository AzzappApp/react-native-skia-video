#include "JEventBridge.h"
#include "JSIJNIConversion.h"

namespace RNSkiaVideo {
using namespace facebook;
using namespace jni;

jni::local_ref<NativeEventDispatcher>
NativeEventDispatcher::create(const RNSkiaVideo::EventReceiver* receiver) {
  return newInstance((jlong)receiver);
}

void NativeEventDispatcher::registerNatives() {
  javaClassStatic()->registerNatives({makeNativeMethod(
      "nativeDispatchEvent", NativeEventDispatcher::dispatchEvent)});
}

void NativeEventDispatcher::dispatchEvent(alias_ref<JClass>, jlong receiverPtr,
                                          std::string eventName,
                                          alias_ref<jobject> data) {
  auto receiver = reinterpret_cast<EventReceiver*>(receiverPtr);
  receiver->handleEvent(eventName, data);
}

JEventBridge::JEventBridge(jsi::Runtime* runtime,
                           RNSkiaVideo::EventEmitter* jsEventEmitter)
    : jsEventEmitter(jsEventEmitter), runtime(runtime) {
  eventDispatcher = make_global(NativeEventDispatcher::create(this));
}

void JEventBridge::handleEvent(std::string eventName, alias_ref<jobject> data) {
  jsEventEmitter->emit(
      eventName, JSIJNIConversion::convertJNIObjectToJSIValue(*runtime, data));
}

global_ref<NativeEventDispatcher> JEventBridge::getEventDispatcher() {
  return eventDispatcher;
}

} // namespace RNSkiaVideo
