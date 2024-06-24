#pragma once

#include <fbjni/fbjni.h>
#include <react-native-skia/JniSkiaManager.h>
#include <react-native-skia/RNSkPlatformContext.h>

namespace RNSkiaVideo {

using namespace facebook;
using namespace jni;

using namespace facebook;
using namespace jni;

struct JNIHelpers : public JavaClass<JNIHelpers> {
  static constexpr auto kJavaDescriptor = "Lcom/azzapp/rnskv/JNIHelpers;";

  static std::shared_ptr<RNSkia::RNSkPlatformContext> getSkiaPlatformContext();
  static std::shared_ptr<facebook::react::CallInvoker> getCallInvoker();
};

} // namespace RNSkiaVideo
