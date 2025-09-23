#include "NativeEventDispatcher.h"
#include "VideoCapabilities.h"
#include "VideoCompositionFramesExtractorHostObject.h"
#include "VideoCompositionFramesExtractorSyncHostObject.h"
#include "VideoEncoderHostObject.h"
#include "VideoPlayerHostObject.h"
#include <fbjni/fbjni.h>
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
          width = (int)res.getProperty(runtime, "width").asNumber();
          height = (int)res.getProperty(runtime, "height").asNumber();
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

  auto createVideoCompositionFramesExtractorSync =
      jsi::Function::createFromHostFunction(
          jsiRuntime,
          jsi::PropNameID::forAscii(
              jsiRuntime, "createVideoCompositionFramesExtractorSync"),
          1,
          [](jsi::Runtime& runtime, const jsi::Value& thisValue,
             const jsi::Value* arguments, size_t count) -> jsi::Value {
            if (count != 1 || !arguments[0].isObject()) {
              throw jsi::JSError(runtime,
                                 "createVideoCompositionFramesExtractorSync(.."
                                 ") expects one arguments (object)!");
            }

            auto instance =
                std::make_shared<VideoCompositionFramesExtractorSyncHostObject>(
                    runtime, arguments[0].asObject(runtime));
            return jsi::Object::createFromHostObject(runtime, instance);
          });

  RNSVModule.setProperty(jsiRuntime,
                         "createVideoCompositionFramesExtractorSync",
                         std::move(createVideoCompositionFramesExtractorSync));

  auto createVideoEncoder = jsi::Function::createFromHostFunction(
      jsiRuntime, jsi::PropNameID::forAscii(jsiRuntime, "createVideoEncoder"),
      1,
      [](jsi::Runtime& runtime, const jsi::Value& thisValue,
         const jsi::Value* arguments, size_t count) -> jsi::Value {
        if (count != 1 || !arguments[0].isObject()) {
          throw jsi::JSError(runtime, "ReactNativeSkiaVideo."
                                      "createVideoEncoder(.."
                                      ") expects one arguments (object)!");
        }

        auto options = arguments[0].asObject(runtime);
        auto outPath = options.getProperty(runtime, "outPath")
                           .asString(runtime)
                           .utf8(runtime);
        int width = (int)options.getProperty(runtime, "width").asNumber();
        int height = (int)options.getProperty(runtime, "height").asNumber();
        int frameRate =
            (int)options.getProperty(runtime, "frameRate").asNumber();
        int bitRate = (int)options.getProperty(runtime, "bitRate").asNumber();
        std::optional<std::string> encoderName = std::nullopt;
        if (options.hasProperty(runtime, "encoderName")) {
          auto value = options.getProperty(runtime, "encoderName");
          if (value.isString()) {
            encoderName = value.asString(runtime).utf8(runtime);
          }
        }

        auto instance = std::make_shared<VideoEncoderHostObject>(
            outPath, width, height, frameRate, bitRate, encoderName);
        return jsi::Object::createFromHostObject(runtime, instance);
      });
  RNSVModule.setProperty(jsiRuntime, "createVideoEncoder",
                         std::move(createVideoEncoder));

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
        int width = (int)arguments[0].asNumber();
        int height = (int)arguments[1].asNumber();
        int framerate = (int)arguments[2].asNumber();
        int bitrate = (int)arguments[3].asNumber();

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

  auto runWithJNIClassLoader = jsi::Function::createFromHostFunction(
      jsiRuntime,
      jsi::PropNameID::forAscii(jsiRuntime, "runWithJNIClassLoader"), 1,
      [](jsi::Runtime& runtime, const jsi::Value& thisValue,
         const jsi::Value* arguments, size_t count) -> jsi::Value {
        auto jsiCallback = std::make_shared<jsi::Function>(
            arguments[0].asObject(runtime).asFunction(runtime));
        jni::Environment::ensureCurrentThreadIsAttached();
        jni::ThreadScope::WithClassLoader(
            [jsiCallback = std::move(jsiCallback), &runtime]() {
              jsiCallback->call(runtime);
            });
        return jsi::Value::undefined();
      });
  RNSVModule.setProperty(jsiRuntime, "runWithJNIClassLoader",
                         std::move(runWithJNIClassLoader));

  jsiRuntime.global().setProperty(jsiRuntime, "RNSkiaVideo",
                                  std::move(RNSVModule));
}

extern "C" JNIEXPORT void JNICALL
Java_com_sheunglaili_rnskv_ReactNativeSkiaVideoModule_nativeInstall(JNIEnv* env,
                                                               jobject clazz,
                                                               jlong jsiPtr) {
  auto runtime = reinterpret_cast<jsi::Runtime*>(jsiPtr);
  if (runtime) {
    install(*runtime);
  }
}

jint JNI_OnLoad(JavaVM* vm, void*) {
  return facebook::jni::initialize(
      vm, [] { NativeEventDispatcher::registerNatives(); });
}
