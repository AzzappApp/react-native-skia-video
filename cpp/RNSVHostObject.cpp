#include "RNSVHostObject.h"

#include <utility>

namespace RNSkiaVideo {

RNSVHostObject::~RNSVHostObject() {
  std::lock_guard<std::mutex> lock(cacheMutex);
  for (auto& entry : caches) {
    RuntimeLifecycleMonitor::removeListener(*entry.first, this);
  }
  caches.clear();
}

void RNSVHostObject::onRuntimeDestroyed(jsi::Runtime* runtime) {
  // The runtime is going away: release its values now, while it is still
  // able to invalidate them.
  std::lock_guard<std::mutex> lock(cacheMutex);
  caches.erase(runtime);
}

RNSVHostObject::RuntimeCache& RNSVHostObject::cacheFor(jsi::Runtime& runtime) {
  auto entry = caches.find(&runtime);
  if (entry == caches.end()) {
    RuntimeLifecycleMonitor::addListener(runtime, this);
    entry = caches.emplace(&runtime, RuntimeCache{}).first;
  }
  return entry->second;
}

jsi::Value RNSVHostObject::getFunction(jsi::Runtime& runtime,
                                       const std::string& name,
                                       unsigned int paramCount,
                                       jsi::HostFunctionType&& function) {
  std::lock_guard<std::mutex> lock(cacheMutex);
  auto& cache = cacheFor(runtime);
  auto entry = cache.values.find(name);
  if (entry == cache.values.end()) {
    auto jsFunction = jsi::Function::createFromHostFunction(
        runtime, jsi::PropNameID::forAscii(runtime, name), paramCount,
        std::move(function));
    entry = cache.values.emplace(name, jsi::Value(runtime, jsFunction)).first;
  }
  return jsi::Value(runtime, entry->second);
}

jsi::Value RNSVHostObject::getVersionedObject(
    jsi::Runtime& runtime, const std::string& key, double version,
    const std::function<void(jsi::Object&)>& fill) {
  std::lock_guard<std::mutex> lock(cacheMutex);
  auto& cache = cacheFor(runtime);
  auto entry = cache.values.find(key);
  if (entry == cache.values.end()) {
    entry = cache.values.emplace(key, jsi::Value(runtime, jsi::Object(runtime)))
                .first;
    cache.versions.erase(key);
  }
  auto versionEntry = cache.versions.find(key);
  if (versionEntry == cache.versions.end() || versionEntry->second != version) {
    auto object = entry->second.asObject(runtime);
    fill(object);
    cache.versions[key] = version;
  }
  return jsi::Value(runtime, entry->second);
}

} // namespace RNSkiaVideo
