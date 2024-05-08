#include "JEventBridge.h"
#include "JSIJNIConversion.h"

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

JEventBridge::JEventBridge(RNSkiaVideo::EventEmitter* jsEventEmitter)
    : jsEventEmitter(jsEventEmitter) {
  eventDispatcher = make_global(NativeEventDispatcher::create(this));
}

void JEventBridge::handleEvent(std::string eventName, alias_ref<jobject> data) {
  jsEventEmitter->emit(eventName, JSIJNIConversion::convertJNIObjectToJSIValue(
                                      *jsEventEmitter->getRuntime(), data));
}

global_ref<NativeEventDispatcher> JEventBridge::getEventDispatcher() {
  return eventDispatcher;
}

} // namespace RNSkiaVideo
