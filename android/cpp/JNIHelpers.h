#pragma once

#include <ReactCommon/CallInvokerHolder.h>
#include <fbjni/fbjni.h>

namespace RNSkiaVideo {

using namespace facebook;
using namespace jni;

using namespace facebook;
using namespace jni;

struct JNIHelpers : public JavaClass<JNIHelpers> {
  static constexpr auto kJavaDescriptor = "Lcom/azzapp/rnskv/JNIHelpers;";

  static std::shared_ptr<facebook::react::CallInvoker> getCallInvoker();
};

} // namespace RNSkiaVideo
