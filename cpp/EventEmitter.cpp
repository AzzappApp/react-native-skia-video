#include "EventEmitter.h"

namespace RNSkiaVideo {

EventEmitter::EventEmitter(jsi::Runtime& runtime,
                           std::shared_ptr<react::CallInvoker> callInvoker)
    : runtime(&runtime), callInvoker(std::move(callInvoker)) {}

EventEmitter::~EventEmitter() {
  for (auto& pair : jsListeners) {
    pair.second.clear();
  }
  jsListeners.clear();
}

jsi::Function EventEmitter::on(std::string eventName, jsi::Function listener) {
  auto sharedListener = std::make_shared<jsi::Function>(std::move(listener));
  jsListeners[eventName].push_back(sharedListener);

  return jsi::Function::createFromHostFunction(
      *runtime, jsi::PropNameID::forAscii(*runtime, "dispose"), 0,
      [this, eventName,
       sharedListener](jsi::Runtime& runtime, const jsi::Value& thisValue,
                       const jsi::Value* arguments, size_t count) {
        jsListeners[eventName].remove(sharedListener);
        return jsi::Value::undefined();
      });
}

void EventEmitter::emit(std::string eventName, jsi::Value data) {
  if (jsListeners.count(eventName) != 0) {
    auto listeners = jsListeners[eventName];
    auto sharedData = std::make_shared<jsi::Value>(std::move(data));
    for (const auto& listener : listeners) {
      callInvoker->invokeAsync([listener, this, sharedData]() {
        listener->call(*runtime, *sharedData);
      });
    }
  }
}

void EventEmitter::removeAllListeners() {
  jsListeners.clear();
}

} // namespace RNSkiaVideo