#pragma once

#include <jsi/jsi.h>

namespace RNSkiaVideo {

namespace jsi = facebook::jsi;

/**
 * Gets notified right before a jsi::Runtime is torn down. Anything that keeps
 * jsi values of that runtime alive (see RNSVHostObject) has to drop them at
 * that point: a jsi::Value destroyed after its runtime is undefined behaviour.
 */
struct RuntimeLifecycleListener {
  virtual ~RuntimeLifecycleListener() {}
  virtual void onRuntimeDestroyed(jsi::Runtime* runtime) = 0;
};

/**
 * Runtime destruction is observed through a host object installed on the
 * runtime's global object: its destructor runs while the runtime is being
 * torn down. Listeners must be added from the runtime's own thread; they can
 * be removed from any thread.
 */
struct RuntimeLifecycleMonitor {
  static void addListener(jsi::Runtime& runtime,
                          RuntimeLifecycleListener* listener);
  static void removeListener(jsi::Runtime& runtime,
                             RuntimeLifecycleListener* listener);
};

} // namespace RNSkiaVideo
