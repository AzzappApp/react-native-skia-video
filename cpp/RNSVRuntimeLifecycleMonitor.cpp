#include "RNSVRuntimeLifecycleMonitor.h"

#include <memory>
#include <mutex>
#include <unordered_map>
#include <unordered_set>
#include <utility>

namespace RNSkiaVideo {

static std::unordered_map<jsi::Runtime*,
                          std::unordered_set<RuntimeLifecycleListener*>>
    listeners;
static std::mutex listenersMutex;

struct RuntimeLifecycleMonitorObject : public jsi::HostObject {
  jsi::Runtime* runtime;
  explicit RuntimeLifecycleMonitorObject(jsi::Runtime* runtime)
      : runtime(runtime) {}
  ~RuntimeLifecycleMonitorObject() override {
    std::unordered_set<RuntimeLifecycleListener*> listenersCopy;
    {
      std::lock_guard<std::mutex> lock(listenersMutex);
      auto entry = listeners.find(runtime);
      if (entry != listeners.end()) {
        listenersCopy = entry->second;
        listeners.erase(entry);
      }
    }
    for (auto listener : listenersCopy) {
      listener->onRuntimeDestroyed(runtime);
    }
  }
};

void RuntimeLifecycleMonitor::addListener(jsi::Runtime& runtime,
                                          RuntimeLifecycleListener* listener) {
  bool installMonitor = false;
  {
    std::lock_guard<std::mutex> lock(listenersMutex);
    auto entry = listeners.find(&runtime);
    if (entry == listeners.end()) {
      listeners.emplace(&runtime,
                        std::unordered_set<RuntimeLifecycleListener*>{listener});
      installMonitor = true;
    } else {
      entry->second.insert(listener);
    }
  }
  if (installMonitor) {
    // The global object owns the monitor: when the runtime is torn down the
    // monitor is destroyed with it and notifies the listeners.
    runtime.global().setProperty(
        runtime, "__rnskv_rt_lifecycle_monitor",
        jsi::Object::createFromHostObject(
            runtime, std::make_shared<RuntimeLifecycleMonitorObject>(&runtime)));
  }
}

void RuntimeLifecycleMonitor::removeListener(
    jsi::Runtime& runtime, RuntimeLifecycleListener* listener) {
  std::lock_guard<std::mutex> lock(listenersMutex);
  auto entry = listeners.find(&runtime);
  if (entry != listeners.end()) {
    entry->second.erase(listener);
  }
}

} // namespace RNSkiaVideo
