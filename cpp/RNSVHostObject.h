#pragma once

#include <functional>
#include <jsi/jsi.h>
#include <mutex>
#include <string>
#include <unordered_map>

#include "RNSVRuntimeLifecycleMonitor.h"

namespace RNSkiaVideo {
using namespace facebook;

/**
 * jsi::HostObject that memoizes, per runtime, the JS objects it hands out.
 *
 * `jsi::Function::createFromHostFunction` allocates a JS function object and
 * a native closure on every call. The frame loops of this library read
 * `decodeNextFrame`, `decodeCompositionFrames`, `encodeFrame`… on the UI or
 * export runtime at every vsync, so creating those functions on each property
 * access adds a couple of garbage collected objects per frame for nothing.
 * Subclasses create each function once per runtime through `getFunction`.
 *
 * Cached values are dropped when their runtime is torn down (dev reload), so
 * no jsi::Value ever outlives its runtime.
 */
class RNSVHostObject : public jsi::HostObject, public RuntimeLifecycleListener {
public:
  ~RNSVHostObject() override;
  void onRuntimeDestroyed(jsi::Runtime* runtime) override;

protected:
  /**
   * Returns the host function `name` of this object for `runtime`, creating
   * it with `function` the first time only.
   */
  jsi::Value getFunction(jsi::Runtime& runtime, const std::string& name,
                         unsigned int paramCount,
                         jsi::HostFunctionType&& function);

  /**
   * Returns the object cached under `key` for `runtime`. The object is created
   * once, and (re)filled through `fill` only when `version` differs from the
   * version it was last filled for. Callers keep a monotonic version of the
   * content they expose, so an unchanged content costs no allocation.
   */
  jsi::Value
  getVersionedObject(jsi::Runtime& runtime, const std::string& key,
                     double version,
                     const std::function<void(jsi::Object&)>& fill);

private:
  struct RuntimeCache {
    std::unordered_map<std::string, jsi::Value> values;
    std::unordered_map<std::string, double> versions;
  };
  std::mutex cacheMutex;
  std::unordered_map<jsi::Runtime*, RuntimeCache> caches;

  // Must be called with cacheMutex held; registers the runtime listener on
  // the first use of a runtime.
  RuntimeCache& cacheFor(jsi::Runtime& runtime);
};

} // namespace RNSkiaVideo
