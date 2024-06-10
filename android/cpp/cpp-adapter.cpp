#include "NativeEventDispatcher.h"
#include "VideoCompositionExporter.h"
#include "VideoCompositionFramesExtractorHostObject.h"
#include "VideoPlayerHostObject.h"
#include <ReactCommon/CallInvokerHolder.h>
#include <WorkletRuntime.h>
#include <jni.h>
#include <jsi/jsi.h>

using namespace facebook;
using namespace RNSkiaVideo;

void install(jsi::Runtime& jsiRuntime) {

  auto RNSVModule = jsi::Object(jsiRuntime);
  auto createVideoPlayer = jsi::Function::createFromHostFunction(
      jsiRuntime, jsi::PropNameID::forAscii(jsiRuntime, "createVideoPlayer"), 2,
      [](jsi::Runtime& runtime, const jsi::Value& thisValue,
         const jsi::Value* arguments, size_t count) -> jsi::Value {
        if (count < 1 || !arguments[0].isString()) {
          throw jsi::JSError(runtime,
                             "ReactNativeSkiaVideo.createVideoPlayer(..) "
                             "expects two arguments (string, object)!");
        }

        int width = -1;
        int height = -1;
        if (count >= 2 && arguments[1].isObject()) {
          auto res = arguments[1].asObject(runtime);
          width = res.getProperty(runtime, "width").asNumber();
          height = res.getProperty(runtime, "height").asNumber();
        }
        auto instance = std::make_shared<VideoPlayerHostObject>(
            runtime, arguments[0].asString(runtime).utf8(runtime), width,
            height);

        return jsi::Object::createFromHostObject(runtime, instance);
      });

  RNSVModule.setProperty(jsiRuntime, "createVideoPlayer",
                         std::move(createVideoPlayer));

  auto createVideoCompositionFramesExtractor =
      jsi::Function::createFromHostFunction(
          jsiRuntime,
          jsi::PropNameID::forAscii(jsiRuntime,
                                    "createVideoCompositionFramesExtractor"),
          1,
          [](jsi::Runtime& runtime, const jsi::Value& thisValue,
             const jsi::Value* arguments, size_t count) -> jsi::Value {
            if (count != 1 || !arguments[0].isObject()) {
              throw jsi::JSError(runtime,
                                 "SkiaVideo.createRNSVCompositionPlayer(.."
                                 ") expects one arguments (object)!");
            }

            auto instance =
                std::make_shared<VideoCompositionFramesExtractorHostObject>(
                    runtime, arguments[0].asObject(runtime));

            return jsi::Object::createFromHostObject(runtime, instance);
          });
  RNSVModule.setProperty(jsiRuntime, "createVideoCompositionFramesExtractor",
                         std::move(createVideoCompositionFramesExtractor));

  auto exportVideoComposition = jsi::Function::createFromHostFunction(
      jsiRuntime,
      jsi::PropNameID::forAscii(jsiRuntime, "exportVideoComposition"), 6,
      [](jsi::Runtime& runtime, const jsi::Value& thisValue,
         const jsi::Value* arguments, size_t count) -> jsi::Value {
        if (count != 6) {
          throw jsi::JSError(runtime,
                             "SkiaVideo.exportVideoComposition(..) expects 4"
                             "arguments (composition, options, workletRuntime, "
                             "drawFrame, onSuccess, onError)!");
        }
        return VideoCompositionExporter::exportVideoComposition(
            runtime, arguments[0].asObject(runtime),
            arguments[1].asObject(runtime),
            reanimated::extractWorkletRuntime(runtime, arguments[2]),
            reanimated::extractShareableOrThrow<reanimated::ShareableWorklet>(
                runtime, arguments[3]),
            arguments[4].asObject(runtime).asFunction(runtime),
            arguments[5].asObject(runtime).asFunction(runtime));
      });
  RNSVModule.setProperty(jsiRuntime, "exportVideoComposition",
                         std::move(exportVideoComposition));

  jsiRuntime.global().setProperty(jsiRuntime, "RNSkiaVideo",
                                  std::move(RNSVModule));
}

extern "C" JNIEXPORT void JNICALL
Java_com_azzapp_rnskv_ReactNativeSkiaVideoModule_nativeInstall(JNIEnv* env,
                                                               jobject clazz,
                                                               jlong jsiPtr) {
  auto runtime = reinterpret_cast<jsi::Runtime*>(jsiPtr);
  if (runtime) {
    install(*runtime);
  }
}

jint JNI_OnLoad(JavaVM* vm, void*) {
  return facebook::jni::initialize(vm, [] {
    NativeEventDispatcher::registerNatives();
    VideoCompositionExporter::registerNatives();
  });
}
