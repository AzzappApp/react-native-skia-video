#include "NativeEventDispatcher.h"
#include "VideoCapabilities.h"
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

  auto getDecodingCapabilitiesFor = jsi::Function::createFromHostFunction(
      jsiRuntime,
      jsi::PropNameID::forAscii(jsiRuntime, "getDecodingCapabilitiesFor"), 1,
      [](jsi::Runtime& runtime, const jsi::Value& thisValue,
         const jsi::Value* arguments, size_t count) -> jsi::Value {
        auto mimetype = arguments[0].asString(runtime).utf8(runtime);

        auto decoderInfo =
            VideoCapabilities::getDecodingCapabilitiesFor(mimetype);
        if (decoderInfo == nullptr) {
          return jsi::Value::null();
        }
        auto result = jsi::Object(runtime);
        result.setProperty(runtime, "maxInstances",
                           jsi::Value(decoderInfo->getMaxInstances()));
        result.setProperty(runtime, "maxWidth",
                           jsi::Value(decoderInfo->getMaxWidth()));
        result.setProperty(runtime, "maxHeight",
                           jsi::Value(decoderInfo->getMaxHeight()));

        return result;
      });

  RNSVModule.setProperty(jsiRuntime, "getDecodingCapabilitiesFor",
                         std::move(getDecodingCapabilitiesFor));

  auto getValidEncoderConfigurations = jsi::Function::createFromHostFunction(
      jsiRuntime,
      jsi::PropNameID::forAscii(jsiRuntime, "getDecodingCapabilitiesFor"), 4,
      [](jsi::Runtime& runtime, const jsi::Value& thisValue,
         const jsi::Value* arguments, size_t count) -> jsi::Value {
        int width = arguments[0].asNumber();
        int height = arguments[1].asNumber();
        int framerate = arguments[2].asNumber();
        int bitrate = arguments[3].asNumber();

        auto encoderInfos = VideoCapabilities::getValidEncoderConfigurations(
            width, height, framerate, bitrate);

        if (encoderInfos == nullptr) {
          return jsi::Value::null();
        }
        auto result = jsi::Array(runtime, encoderInfos->size());
        size_t i = 0;
        for (const auto& encoderInfo : *encoderInfos) {
          auto jsObject = jsi::Object(runtime);
          jsObject.setProperty(runtime, "encoderName",
                               jsi::String::createFromUtf8(
                                   runtime, encoderInfo->getEncoderName()));
          jsObject.setProperty(
              runtime, "hardwareAccelerated",
              jsi::Value(encoderInfo->getHardwareAccelerated()));
          jsObject.setProperty(runtime, "width",
                               jsi::Value(encoderInfo->getWidth()));
          jsObject.setProperty(runtime, "height",
                               jsi::Value(encoderInfo->getHeight()));
          jsObject.setProperty(runtime, "frameRate",
                               jsi::Value(encoderInfo->getFrameRate()));
          jsObject.setProperty(runtime, "bitRate",
                               jsi::Value(encoderInfo->getBitrate()));

          result.setValueAtIndex(runtime, i, jsObject);
          i++;
        }
        return result;
      });

  RNSVModule.setProperty(jsiRuntime, "getValidEncoderConfigurations",
                         std::move(getValidEncoderConfigurations));

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
