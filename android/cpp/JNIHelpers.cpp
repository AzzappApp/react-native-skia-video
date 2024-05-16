#include "JNIHelpers.h"

namespace RNSkiaVideo {

using namespace RNSkia;

std::shared_ptr<RNSkPlatformContext> JNIHelpers::getSkiaPlatformContext() {
  auto clazz = javaClassStatic();
  static const auto getSkiaPlatformContextMethod =
      clazz->getStaticMethod<jobject()>("getSkiaPlatformContext");
  auto skiaManager = static_ref_cast<JniSkiaManager::javaobject>(
      getSkiaPlatformContextMethod(clazz));
  return skiaManager->cthis()->getPlatformContext();
}

std::shared_ptr<facebook::react::CallInvoker> JNIHelpers::getCallInvoker() {
  auto clazz = javaClassStatic();
  static const auto getCallInvokerMethod =
      clazz->getStaticMethod<jobject()>("getCallInvoker");
  auto callInvoker =
      static_ref_cast<facebook::react::CallInvokerHolder::javaobject>(
          getCallInvokerMethod(clazz));
  return callInvoker->cthis()->getCallInvoker();
}

} // namespace RNSkiaVideo
