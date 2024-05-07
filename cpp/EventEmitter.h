#pragma once

#include <ReactCommon/CallInvoker.h>
#include <jsi/jsi.h>
#include <list>
#include <map>

namespace RNSkiaVideo {
using namespace facebook;
class EventEmitter {
public:
  EventEmitter(jsi::Runtime& runtime,
               std::shared_ptr<react::CallInvoker> callInvoker);
  ~EventEmitter();
  jsi::Function on(std::string eventName, jsi::Function listener);
  void emit(std::string eventName);
  void emit(std::string eventName, jsi::Value data);
  void emit(std::string eventName,
            std::function<jsi::Value(jsi::Runtime&)> dataFactory);
  void removeAllListeners();
  jsi::Runtime* getRuntime();

protected:
  jsi::Runtime* runtime;
  std::shared_ptr<react::CallInvoker> callInvoker;

private:
  std::map<std::string, std::list<std::shared_ptr<facebook::jsi::Function>>>
      jsListeners;
};
} // namespace RNSkiaVideo
