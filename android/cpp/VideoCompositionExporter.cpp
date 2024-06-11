//
// Created by François de Campredon on 22/03/2024.
//

#include "VideoCompositionExporter.h"
#include <EGL/eglext.h>
#include <JsiSkCanvas.h>
#include <gpu/ganesh/SkSurfaceGanesh.h>
#include <gpu/ganesh/gl/GrGLBackendSurface.h>

#include "JNIHelpers.h"

namespace RNSkiaVideo {

using namespace RNSkia;

jsi::Value VideoCompositionExporter::exportVideoComposition(
    jsi::Runtime& runtime, jsi::Object jsComposition, jsi::Object options,
    std::shared_ptr<reanimated::WorkletRuntime> workletRuntime,
    std::shared_ptr<reanimated::ShareableWorklet> drawFrame,
    jsi::Function onSuccess, jsi::Function onError) {

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
                                       workletRuntime, drawFrame);

  auto sharedSuccessCallback =
      std::make_shared<jsi::Function>(std::move(onSuccess));
  auto sharedErrorCallback =
      std::make_shared<jsi::Function>(std::move(onError));

  exporter->cthis()->start(
      [=, &runtime]() {
        JNIHelpers::getCallInvoker()->invokeAsync([=, &runtime]() -> void {
          exporter->cthis()->release();
          sharedSuccessCallback->call(runtime);
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
          sharedErrorCallback->call(runtime, error);
        });
      });
  return jsi::Value::undefined();
}

global_ref<VideoCompositionExporter::JavaPart> VideoCompositionExporter::create(
    alias_ref<RNSkiaVideo::VideoComposition> composition, std::string& outPath,
    int width, int height, int frameRate, int bitRate,
    std::optional<std::string> encoderName,
    std::shared_ptr<reanimated::WorkletRuntime> workletRuntime,
    std::shared_ptr<reanimated::ShareableWorklet> drawFrame) {

  auto hybridData = makeHybridData(std::make_unique<VideoCompositionExporter>(
      width, height, workletRuntime, drawFrame));
  auto jExporter = newObjectJavaArgs(
      hybridData, composition, outPath, width, height, frameRate, bitRate,
      encoderName.has_value() ? encoderName.value() : nullptr);

  auto globalExporter = make_global(jExporter);
  jExporter->cthis()->jThis = globalExporter;
  return globalExporter;
}

VideoCompositionExporter::VideoCompositionExporter(
    int width, int height,
    std::shared_ptr<reanimated::WorkletRuntime> workletRuntime,
    std::shared_ptr<reanimated::ShareableWorklet> drawFrame) {
  this->width = width;
  this->height = height;
  this->drawFrameWorklet = drawFrame;
  this->workletRuntime = workletRuntime;
}

void VideoCompositionExporter::registerNatives() {
  registerHybrid(
      {makeNativeMethod("makeSkiaSharedContextCurrent",
                        VideoCompositionExporter::makeSkiaSharedContextCurrent),
       makeNativeMethod("renderFrame", VideoCompositionExporter::renderFrame),
       makeNativeMethod("onComplete", VideoCompositionExporter::onComplete),
       makeNativeMethod("onError", VideoCompositionExporter::onError)});
}

void VideoCompositionExporter::start(
    std::function<void()> onComplete,
    std::function<void(alias_ref<JObject> e)> onError) {
  this->onCompleteCallback = onComplete;
  this->onErrorCallback = onError;
  auto startMethod = jThis->getClass()->getMethod<void()>("start");
  startMethod(jThis);
}

void VideoCompositionExporter::makeSkiaSharedContextCurrent() {
  if (surface == nullptr) {
    surface = SkiaOpenGLSurfaceFactory::makeOffscreenSurface(width, height);
    jsiCanvas = std::make_shared<JsiSkCanvas>(
        JNIHelpers::getSkiaPlatformContext(), surface->getCanvas());

    jsiCanvasProxy =
        std::make_shared<jsi::Object>(workletRuntime->getJSIRuntime());
    auto& jsiCanvasMap = jsiCanvas->getExportedFunctionMap();
    for (auto& entry : jsiCanvasMap) {
      auto propName = entry.first;
      auto func = std::bind(entry.second, jsiCanvas, std::placeholders::_1,
                            std::placeholders::_2, std::placeholders::_3,
                            std::placeholders::_4);
      jsiCanvasProxy->setProperty(
          workletRuntime->getJSIRuntime(), propName.c_str(),
          jsi::Function::createFromHostFunction(
              workletRuntime->getJSIRuntime(),
              jsi::PropNameID::forUtf8(workletRuntime->getJSIRuntime(),
                                       propName),
              0,
              [=](jsi::Runtime& runtime, const jsi::Value& thisValue,
                  const jsi::Value* arguments, size_t count) -> jsi::Value {
                return func(workletRuntime->getJSIRuntime(), thisValue,
                            arguments, count);
              }));
    }
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
  auto result = jsi::Object(workletRuntime->getJSIRuntime());
  auto platformContext = JNIHelpers::getSkiaPlatformContext();
  for (auto& entry : *frames) {
    auto id = entry.first->toStdString();
    auto frame = entry.second;
    auto jsFrame = frame->toJS(workletRuntime->getJSIRuntime());
    result.setProperty(workletRuntime->getJSIRuntime(), id.c_str(),
                       std::move(jsFrame));
  }
  surface->getCanvas()->clear(SkColors::kTransparent);

  auto canvasProxy = jsiCanvasProxy.get();
  workletRuntime->runGuarded(drawFrameWorklet, *canvasProxy, currentTime, result);

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
  jsiCanvas = nullptr;
  jsiCanvasProxy = nullptr;
}

void VideoCompositionExporter::onComplete() {
  onCompleteCallback();
}

void VideoCompositionExporter::onError(alias_ref<JObject> e) {
  onErrorCallback(e);
}
} // namespace RNSkiaVideo
