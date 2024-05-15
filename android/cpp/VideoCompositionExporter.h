#pragma once

#include <GLES/egl.h>
#include <SkSurface.h>
#include <WorkletRuntime.h>
#include <fbjni/fbjni.h>

#include "VideoComposition.h"
#include "VideoFrame.h"

namespace RNSkiaVideo {
using namespace facebook;
using namespace jni;

class VideoCompositionExporter : public HybridClass<VideoCompositionExporter> {
public:
  static constexpr auto kJavaDescriptor =
      "Lcom/azzapp/rnskv/VideoCompositionExporter;";
  static global_ref<VideoCompositionExporter::JavaPart>
  create(alias_ref<VideoComposition> composition, std::string& outPath,
         int width, int height, int frameRate, int bitRate,
         std::shared_ptr<reanimated::WorkletRuntime> workletRuntime,
         std::shared_ptr<reanimated::ShareableWorklet> drawFrame);

  explicit VideoCompositionExporter(
      int width, int height,
      std::shared_ptr<reanimated::WorkletRuntime> workletRuntime,
      std::shared_ptr<reanimated::ShareableWorklet> drawFrame);

  static void registerNatives();

  static jsi::Value exportVideoComposition(
      jsi::Runtime& runtime, jsi::Object composition, jsi::Object options,
      std::shared_ptr<reanimated::WorkletRuntime> workletRuntime,
      std::shared_ptr<reanimated::ShareableWorklet> drawFrame,
      jsi::Function onSuccess, jsi::Function onError);

private:
  friend HybridBase;
  jni::global_ref<javaobject> jThis;
  int width;
  int height;
  std::shared_ptr<reanimated::WorkletRuntime> workletRuntime;
  std::shared_ptr<reanimated::ShareableWorklet> drawFrameWorklet;
  std::function<void()> onCompleteCallback;
  std::function<void()> onErrorCallback;
  EGLSurface glSurface;
  ANativeWindow* window;
  sk_sp<SkSurface> surface;

  void start(std::function<void()> onCompleteCallback,
             std::function<void()> onErrorCallback);
  local_ref<jobject> getCodecInputSurface() const;
  void renderFrame(jdouble timeUS, alias_ref<JMap<JString, VideoFrame>> frames);
  void onComplete();
  void onError(alias_ref<JObject> e);
  void release();
};
} // namespace RNSkiaVideo
