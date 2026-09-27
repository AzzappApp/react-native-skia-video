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
  auto versionEntry = cache.versions.find(key);
  if (entry == cache.values.end() || versionEntry == cache.versions.end() ||
      versionEntry->second != version) {
    // A fresh object for each version. Filled in place, the previous one kept
    // the properties the new content no longer has: the frame of an item
    // whose decoder had closed stayed in the frames object, with a texture
    // deleted since, and drawing it after a seek back into the item threw
    // from the frame callback (Android) or showed a stale picture (iOS).
    jsi::Object object(runtime);
    fill(object);
    entry = cache.values.insert_or_assign(key, jsi::Value(runtime, object))
                .first;
    cache.versions[key] = version;
  }
  return jsi::Value(runtime, entry->second);
}

} // namespace RNSkiaVideo
