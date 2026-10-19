#include "RNSVEventEmitter.h"

namespace RNSkiaVideo {

EventEmitter::EventEmitter(jsi::Runtime& runtime,
                           std::shared_ptr<react::CallInvoker> callInvoker)
    : runtime(&runtime), callInvoker(std::move(callInvoker)) {}

EventEmitter::~EventEmitter() {
  removeAllListeners();
}

jsi::Function EventEmitter::on(std::string eventName, jsi::Function listener) {
  auto sharedListener = std::make_shared<jsi::Function>(std::move(listener));
  (*jsListeners)[eventName].push_back(sharedListener);

  std::weak_ptr<Listeners> weakListeners = jsListeners;
  return jsi::Function::createFromHostFunction(
      *runtime, jsi::PropNameID::forAscii(*runtime, "dispose"), 0,
      [weakListeners, eventName,
       sharedListener](jsi::Runtime& runtime, const jsi::Value& thisValue,
                       const jsi::Value* arguments, size_t count) {
        if (auto listeners = weakListeners.lock()) {
          (*listeners)[eventName].remove(sharedListener);
        }
        return jsi::Value::undefined();
      });
}

void EventEmitter::emit(std::string eventName) {
  emit(eventName, jsi::Value::undefined());
}

void EventEmitter::emit(std::string eventName, jsi::Value data) {
  auto sharedData = std::make_shared<jsi::Value>(std::move(data));
  emit(eventName, [=](jsi::Runtime& runtime) -> jsi::Value {
    return jsi::Value(runtime, *sharedData);
  });
}

void EventEmitter::emit(std::string eventName,
                        std::function<jsi::Value(jsi::Runtime&)> dataFactory) {
  std::weak_ptr<Listeners> weakListeners = jsListeners;
  auto runtime = this->runtime;
  callInvoker->invokeAsync([=]() {
    auto listeners = weakListeners.lock();
    if (listeners == nullptr || listeners->count(eventName) == 0) {
      return;
    }
    // A copy: a listener can add or remove listeners.
    auto eventListeners = (*listeners)[eventName];
    auto data = dataFactory(*runtime);
    for (const auto& listener : eventListeners) {
      listener->call(*runtime, data);
    }
  });
}

jsi::Runtime* EventEmitter::getRuntime() {
  return runtime;
}

void EventEmitter::removeAllListeners() {
  jsListeners->clear();
}

} // namespace RNSkiaVideo
