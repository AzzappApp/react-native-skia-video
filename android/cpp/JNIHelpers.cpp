#include "JNIHelpers.h"

namespace RNSkiaVideo {

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
