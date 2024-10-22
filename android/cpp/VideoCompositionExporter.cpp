//
// Created by François de Campredon on 22/03/2024.
//

#include "VideoCompositionExporter.h"
#include <EGL/eglext.h>
#include <react-native-skia/JsiSkCanvas.h>
#include <react-native-skia/include/gpu/ganesh/SkSurfaceGanesh.h>
#include <react-native-skia/include/gpu/ganesh/gl/GrGLBackendSurface.h>

#include "JNIHelpers.h"

namespace RNSkiaVideo {

using namespace RNSkia;

jsi::Value VideoCompositionExporter::exportVideoComposition(
    jsi::Runtime& runtime, jsi::Object jsComposition, jsi::Object options,
    std::shared_ptr<worklets::WorkletRuntime> workletRuntime,
    std::shared_ptr<worklets::ShareableWorklet> drawFrame,
    std::shared_ptr<jsi::Function> onSuccess,
    std::shared_ptr<jsi::Function> onError,
    std::shared_ptr<jsi::Function> onProgress,
    std::shared_ptr<RNSkia::JsiSkSurface> jsiSurface) {

  auto composition = VideoComposition::fromJSIObject(runtime, jsComposition);
  auto outPath =
      options.getProperty(runtime, "outPath").asString(runtime).utf8(runtime);
  int width = options.getProperty(runtime, "width").asNumber();
  int height = options.getProperty(runtime, "height").asNumber();
  int frameRate = options.getProperty(runtime, "frameRate").asNumber();
  int bitRate = options.getProperty(runtime, "bitRate").asNumber();
  std::optional<std::string> encoderName = std::nullopt;
  if (options.hasProperty(runtime, "encoderName")) {
    auto value = options.getProperty(runtime, "encoderName");
    if (value.isString()) {
      encoderName = value.asString(runtime).utf8(runtime);
    }
  }

  global_ref<VideoCompositionExporter::JavaPart> exporter =
      VideoCompositionExporter::create(composition, outPath, width, height,
                                       frameRate, bitRate, encoderName,
                                       workletRuntime, drawFrame, jsiSurface);

  exporter->cthis()->start(
      [=, &runtime]() {
        JNIHelpers::getCallInvoker()->invokeAsync([=, &runtime]() -> void {
          exporter->cthis()->release();
          onSuccess->call(runtime);
        });
      },
      [=, &runtime](alias_ref<JObject> error) {
        std::optional<std::string> errorMessage = std::nullopt;
        if (error->isInstanceOf(jni::JThrowable::javaClassStatic())) {
          auto throwable = static_ref_cast<jni::JThrowable>(error);
          errorMessage = throwable->getMessage()->toStdString();
        } else if (error->isInstanceOf(jni::JString::javaClassStatic())) {
          auto string = static_ref_cast<jni::JString>(error);
          errorMessage = error->toString();
        }
        JNIHelpers::getCallInvoker()->invokeAsync([=, &runtime]() -> void {
          exporter->cthis()->release();
          jsi::Value error;
          if (errorMessage.has_value()) {
            error = jsi::String::createFromUtf8(runtime, errorMessage.value());
          } else {
            error = jsi::Value::null();
          }
          onError->call(runtime, error);
        });
      },
      [=, &runtime](int frame) {
        JNIHelpers::getCallInvoker()->invokeAsync([=, &runtime]() -> void {
          if (onProgress != nullptr) {
            onProgress->call(runtime, jsi::Value(frame));
          }
        });
      });
  return jsi::Value::undefined();
}

global_ref<VideoCompositionExporter::JavaPart> VideoCompositionExporter::create(
    alias_ref<RNSkiaVideo::VideoComposition> composition, std::string& outPath,
    int width, int height, int frameRate, int bitRate,
    std::optional<std::string> encoderName,
    std::shared_ptr<worklets::WorkletRuntime> workletRuntime,
    std::shared_ptr<worklets::ShareableWorklet> drawFrame,
    std::shared_ptr<RNSkia::JsiSkSurface> jsiSurface) {

  auto hybridData = makeHybridData(std::make_unique<VideoCompositionExporter>(
      width, height, workletRuntime, drawFrame, jsiSurface));
  auto jExporter = newObjectJavaArgs(
      hybridData, composition, outPath, width, height, frameRate, bitRate,
      encoderName.has_value() ? encoderName.value() : nullptr);

  auto globalExporter = make_global(jExporter);
  jExporter->cthis()->jThis = globalExporter;
  return globalExporter;
}

VideoCompositionExporter::VideoCompositionExporter(
    int width, int height,
    std::shared_ptr<worklets::WorkletRuntime> workletRuntime,
    std::shared_ptr<worklets::ShareableWorklet> drawFrame,
    std::shared_ptr<RNSkia::JsiSkSurface> jsiSurface) {
  this->width = width;
  this->height = height;
  this->drawFrameWorklet = drawFrame;
  this->workletRuntime = workletRuntime;
  this->jsiSurface = jsiSurface;
}

void VideoCompositionExporter::registerNatives() {
  registerHybrid(
      {makeNativeMethod("makeSkiaSharedContextCurrent",
                        VideoCompositionExporter::makeSkiaSharedContextCurrent),
       makeNativeMethod("renderFrame", VideoCompositionExporter::renderFrame),
       makeNativeMethod("onComplete", VideoCompositionExporter::onComplete),
       makeNativeMethod("onError", VideoCompositionExporter::onError),
       makeNativeMethod("onProgress", VideoCompositionExporter::onProgress)});
}

void VideoCompositionExporter::start(
    std::function<void()> onComplete,
    std::function<void(alias_ref<JObject> e)> onError,
    std::function<void(int frame)> onProgressCallback) {
  this->onCompleteCallback = onComplete;
  this->onErrorCallback = onError;
  this->onProgressCallback = onProgressCallback;
  auto startMethod = jThis->getClass()->getMethod<void()>("start");
  startMethod(jThis);
}

void VideoCompositionExporter::makeSkiaSharedContextCurrent() {
  if (surface == nullptr) {
    surface = SkiaOpenGLSurfaceFactory::makeOffscreenSurface(width, height);
    jsiSurface->setObject(surface);
  }
  SkiaOpenGLHelper::makeCurrent(
      &ThreadContextHolder::ThreadSkiaOpenGLContext,
      ThreadContextHolder::ThreadSkiaOpenGLContext.gl1x1Surface);
}

int VideoCompositionExporter::renderFrame(
    jdouble time, alias_ref<JMap<JString, VideoFrame>> frames) {
  SkiaOpenGLHelper::makeCurrent(
      &ThreadContextHolder::ThreadSkiaOpenGLContext,
      ThreadContextHolder::ThreadSkiaOpenGLContext.gl1x1Surface);
  auto currentTime = jsi::Value(time);
  auto& runtime = workletRuntime->getJSIRuntime();
  auto result = jsi::Object(runtime);
  auto platformContext = JNIHelpers::getSkiaPlatformContext();
  for (auto& entry : *frames) {
    auto id = entry.first->toStdString();
    auto frame = entry.second;
    auto jsFrame = frame->toJS(runtime);
    result.setProperty(runtime, id.c_str(), std::move(jsFrame));
  }
  surface->getCanvas()->clear(SkColors::kTransparent);

  workletRuntime->runGuarded(drawFrameWorklet, currentTime, result);

  GrAsDirectContext(surface->recordingContext())->flushAndSubmit();
  GrBackendTexture texture = SkSurfaces::GetBackendTexture(
      surface.get(), SkSurfaces::BackendHandleAccess::kFlushRead);
  if (!texture.isValid()) {
    return -1;
  }

  GrGLTextureInfo textureInfo;
  return GrBackendTextures::GetGLTextureInfo(texture, &textureInfo)
             ? textureInfo.fID
             : -1;
}

void VideoCompositionExporter::release() {
  jThis = nullptr;
  surface = nullptr;
  jsiSurface = nullptr;
}

void VideoCompositionExporter::onProgress(jint frame) {
  onProgressCallback(frame);
}

void VideoCompositionExporter::onComplete() {
  onCompleteCallback();
}

void VideoCompositionExporter::onError(alias_ref<JObject> e) {
  onErrorCallback(e);
}
} // namespace RNSkiaVideo
