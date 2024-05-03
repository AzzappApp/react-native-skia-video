//
// Created by François de Campredon on 22/03/2024.
//

#include "VideoCompositionExporter.h"
#include <EGL/eglext.h>
#include <JsiSkCanvas.h>

#include "RNSkiaHelpers.h"

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

  auto exporter = VideoCompositionExporter::create(composition, outPath, width,
                                                   height, frameRate, bitRate,
                                                   workletRuntime, drawFrame);
  auto sharedExporter =
      std::shared_ptr<VideoCompositionExporter>(std::move(exporter));

  auto sharedSuccessCallback =
      std::make_shared<jsi::Function>(std::move(onSuccess));
  auto sharedErrorCallback =
      std::make_shared<jsi::Function>(std::move(onError));

  sharedExporter->start(
      [sharedExporter, &runtime, sharedSuccessCallback]() {
        sharedExporter->release();
        RNSkiaHelpers::getCallInvoker()->invokeAsync(
            [&runtime, sharedSuccessCallback]() -> void {
              sharedSuccessCallback->call(runtime);
            });
      },
      [sharedExporter, &runtime, sharedErrorCallback]() {
        sharedExporter->release();
        RNSkiaHelpers::getCallInvoker()->invokeAsync(
            [&runtime, sharedErrorCallback]() -> void {
              sharedErrorCallback->call(runtime);
            });
      });

  return jsi::Value::undefined();
}

VideoCompositionExporter* VideoCompositionExporter::create(
    alias_ref<VideoComposition> composition, std::string& outPath, int width,
    int height, int frameRate, int bitRate,
    std::shared_ptr<reanimated::WorkletRuntime> workletRuntime,
    std::shared_ptr<reanimated::ShareableWorklet> drawFrame) {
  VideoCompositionExporter* exporter =
      new VideoCompositionExporter(width, height, workletRuntime, drawFrame);
  auto hybridData =
      makeHybridData(std::unique_ptr<VideoCompositionExporter>(exporter));
  auto javaPart = newObjectJavaArgs(hybridData, composition, outPath, width,
                                    height, frameRate, bitRate);
  exporter->jThis = make_global(javaPart);
  return exporter;
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
      {makeNativeMethod("renderFrame", VideoCompositionExporter::renderFrame),
       makeNativeMethod("onComplete", VideoCompositionExporter::onComplete),
       makeNativeMethod("onError", VideoCompositionExporter::onError)});
}

void VideoCompositionExporter::start(std::function<void()> onComplete,
                                     std::function<void()> onError) {
  this->onCompleteCallback = onComplete;
  this->onErrorCallback = onError;
  auto startMethod = jThis->getClass()->getMethod<void()>("start");
  startMethod(jThis);
}

void VideoCompositionExporter::renderFrame(
    jlong timeUS, alias_ref<JMap<JString, VideoFrame>> frames) {
  auto env = Environment::current();
  if (this->surface == nullptr) {
    auto jSurface = getCodecInputSurface();
    window = ANativeWindow_fromSurface(env, jSurface.get());
    auto pair = RNSkiaHelpers::createWindowSkSurface(window, width, height);
    if (!pair.has_value()) {
      throw std::runtime_error("Could not create skia surface");
    }
    surface = pair->first;
    glSurface = pair->second;
  }
  SkiaOpenGLHelper::makeCurrent(&ThreadContextHolder::ThreadSkiaOpenGLContext,
                                glSurface);
  auto timeMS = jsi::Value((double)timeUS / 1000);
  auto result = jsi::Object(workletRuntime->getJSIRuntime());
  auto platformContext = RNSkiaHelpers::getSkiaPlatformContext();
  for (auto& entry : *frames) {
    auto id = entry.first->toStdString();
    auto frame = entry.second;
    auto jsFrame = frame->toJS(workletRuntime->getJSIRuntime());
    result.setProperty(workletRuntime->getJSIRuntime(), id.c_str(),
                       std::move(jsFrame));
  }
  surface->getCanvas()->clear(SkColors::kTransparent);
  auto skCanvas = jsi::Object::createFromHostObject(
      workletRuntime->getJSIRuntime(),
      std::make_shared<JsiSkCanvas>(RNSkiaHelpers::getSkiaPlatformContext(),
                                    surface->getCanvas()));
  workletRuntime->runGuarded(drawFrameWorklet, skCanvas, timeMS, result);
  GrAsDirectContext(surface->recordingContext())->flushAndSubmit();
  eglPresentationTimeANDROID(OpenGLResourceHolder::getInstance().glDisplay,
                             glSurface, timeUS * 1000);
  eglSwapBuffers(OpenGLResourceHolder::getInstance().glDisplay, glSurface);
}

local_ref<jobject> VideoCompositionExporter::getCodecInputSurface() const {
  static const auto getCodecInputSurfaceMethod =
      jThis->getClass()->getMethod<jobject()>("getCodecInputSurface");
  return getCodecInputSurfaceMethod(jThis);
}

void VideoCompositionExporter::release() {
  this->surface = nullptr;
  if (glSurface != nullptr) {
    eglDestroySurface(OpenGLResourceHolder::getInstance().glDisplay, glSurface);
  }
  if (window != nullptr) {
    ANativeWindow_release(window);
  }
}

void VideoCompositionExporter::onComplete() {
  onCompleteCallback();
}

void VideoCompositionExporter::onError(alias_ref<JObject> e) {
  // TODO convert java error to js error
  onErrorCallback();
}
} // namespace RNSkiaVideo
