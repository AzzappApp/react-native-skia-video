#pragma once

#include <JniSkiaManager.h>
#include <RNSkPlatformContext.h>
#include <fbjni/fbjni.h>

namespace RNSkiaVideo {

using namespace facebook;
using namespace jni;

using namespace facebook;
using namespace jni;

struct RNSkiaHelpers : public JavaClass<RNSkiaHelpers> {
  static constexpr auto kJavaDescriptor = "Lcom/azzapp/rnskv/RNSkiaHelpers;";

  static std::shared_ptr<RNSkia::RNSkPlatformContext> getSkiaPlatformContext();
  static std::shared_ptr<facebook::react::CallInvoker> getCallInvoker();

  static std::optional<std::pair<sk_sp<SkSurface>, EGLSurface>>
  createWindowSkSurface(ANativeWindow* window, int width, int height);
};

} // namespace RNSkiaVideo
