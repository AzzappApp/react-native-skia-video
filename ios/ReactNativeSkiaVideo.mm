#import "ReactNativeSkiaVideo.h"

#import <React/RCTBridge+Private.h>
#import <React/RCTBridge.h>
#import <React/RCTCallInvoker.h>
#import <React/RCTUtils.h>
#import <ReactCommon/RCTTurboModule.h>
#import <jsi/jsi.h>

#import "JSIUtils.h"
#import "VideoComposition.h"
#import "VideoCompositionFramesExtractorHostObject.h"
#import "VideoCompositionFramesExtractorSyncHostObject.h"
#import "VideoEncoderHostObject.h"
#import "VideoPlayerHostObject.h"

// In bridgeless mode `self.bridge` is an RCTBridgeProxy; its `runtime`
// accessor is not declared in public headers.
@interface RCTBridge (JSIRuntime)
- (void*)runtime;
@end

@implementation ReactNativeSkiaVideo

@synthesize bridge = _bridge;
@synthesize callInvoker = _callInvoker;

RCT_EXPORT_MODULE()
RCT_EXPORT_BLOCKING_SYNCHRONOUS_METHOD(install) {
  using namespace facebook;
  using namespace RNSkiaVideo;

  auto jsiRuntime = reinterpret_cast<jsi::Runtime*>(self.bridge.runtime);
  if (jsiRuntime == nullptr) {
    return @false;
  }
  std::shared_ptr<react::CallInvoker> jsCallInvoker =
      self.callInvoker.callInvoker;
  if (jsCallInvoker == nullptr) {
    return @false;
  }
  auto& runtime = *jsiRuntime;
  auto RNSVModule = jsi::Object(runtime);

  auto createVideoPlayer = jsi::Function::createFromHostFunction(
      runtime, jsi::PropNameID::forAscii(runtime, "createVideoPlayer"), 2,
      [jsCallInvoker](jsi::Runtime& runtime, const jsi::Value& thisValue,
                      const jsi::Value* arguments, size_t count) -> jsi::Value {
        if (count < 1 || !arguments[0].isString()) {
          throw jsi::JSError(runtime,
                             "ReactNativeSkiaVideo.createVideoPlayer(."
                             ".) expects two arguments (string, object)!");
        }

        NSString* urlStr;
        try {
          urlStr = [NSString stringWithUTF8String:arguments[0]
                                                      .asString(runtime)
                                                      .utf8(runtime)
                                                      .c_str()];
        } catch (NSError* error) {
          throw jsi::JSError(
              runtime, "SkiaVideo.createRNSVPlayer(..) could not parse url");
        }
        CGSize resolution = CGSize();
        if (count >= 2 && arguments[1].isObject()) {
          auto res = arguments[1].asObject(runtime);
          resolution.width = res.getProperty(runtime, "width").asNumber();
          resolution.height = res.getProperty(runtime, "height").asNumber();
        }

        NSURL* url = [NSURL URLWithString:urlStr];

        auto instance = std::make_shared<VideoPlayerHostObject>(
            runtime, jsCallInvoker, url, resolution);
        return jsi::Object::createFromHostObject(runtime, instance);
      });
  RNSVModule.setProperty(runtime, "createVideoPlayer",
                         std::move(createVideoPlayer));

  runtime.global().setProperty(runtime, "RNSkiaVideo", RNSVModule);

  auto createVideoCompositionFramesExtractor =
      jsi::Function::createFromHostFunction(
          runtime,
          jsi::PropNameID::forAscii(runtime,
                                    "createVideoCompositionFramesExtractor"),
          1,
          [jsCallInvoker](jsi::Runtime& runtime, const jsi::Value& thisValue,
                          const jsi::Value* arguments,
                          size_t count) -> jsi::Value {
            if (count != 1 || !arguments[0].isObject()) {
              throw jsi::JSError(runtime,
                                 "ReactNativeSkiaVideo."
                                 "createVideoCompositionFramesExtractor(.."
                                 ") expects one arguments (object)!");
            }

            jsi::Object jsObject = arguments[0].asObject(runtime);
            auto videoComposition = VideoComposition::fromJS(runtime, jsObject);
            auto instance =
                std::make_shared<VideoCompositionFramesExtractorHostObject>(
                    runtime, jsCallInvoker, videoComposition);
            return jsi::Object::createFromHostObject(runtime, instance);
          });
  RNSVModule.setProperty(runtime, "createVideoCompositionFramesExtractor",
                         std::move(createVideoCompositionFramesExtractor));

  auto createVideoCompositionFramesExtractorSync =
      jsi::Function::createFromHostFunction(
          runtime,
          jsi::PropNameID::forAscii(
              runtime, "createVideoCompositionFramesExtractorSync"),
          1,
          [](jsi::Runtime& runtime, const jsi::Value& thisValue,
             const jsi::Value* arguments, size_t count) -> jsi::Value {
            if (count != 1 || !arguments[0].isObject()) {
              throw jsi::JSError(runtime,
                                 "ReactNativeSkiaVideo."
                                 "createVideoCompositionFramesExtractorSync(..)"
                                 " expects one arguments (object)!");
            }

            jsi::Object jsObject = arguments[0].asObject(runtime);
            auto videoComposition = VideoComposition::fromJS(runtime, jsObject);
            auto instance =
                std::make_shared<VideoCompositionFramesExtractorSyncHostObject>(
                    videoComposition);
            return jsi::Object::createFromHostObject(runtime, instance);
          });

  RNSVModule.setProperty(runtime, "createVideoCompositionFramesExtractorSync",
                         std::move(createVideoCompositionFramesExtractorSync));

  auto createVideoEncoder = jsi::Function::createFromHostFunction(
      runtime, jsi::PropNameID::forAscii(runtime, "createVideoEncoder"), 2,
      [](jsi::Runtime& runtime, const jsi::Value& thisValue,
         const jsi::Value* arguments, size_t count) -> jsi::Value {
        if (count < 1 || !arguments[0].isObject()) {
          throw jsi::JSError(
              runtime,
              "ReactNativeSkiaVideo.createVideoEncoder(..) expects an options "
              "object and an optional composition object!");
        }

        auto options = arguments[0].asObject(runtime);
        auto outPath = options.getProperty(runtime, "outPath")
                           .asString(runtime)
                           .utf8(runtime);
        int width = options.getProperty(runtime, "width").asNumber();
        int height = options.getProperty(runtime, "height").asNumber();
        int frameRate = options.getProperty(runtime, "frameRate").asNumber();
        int bitRate = options.getProperty(runtime, "bitRate").asNumber();
        int audioBitRate = 128000;
        int audioSampleRate = 44100;
        int audioChannelCount = 2;
        if (options.hasProperty(runtime, "audioBitRate")) {
          auto value = options.getProperty(runtime, "audioBitRate");
          if (value.isNumber()) {
            audioBitRate = value.asNumber();
          }
        }
        if (options.hasProperty(runtime, "audioSampleRate")) {
          auto value = options.getProperty(runtime, "audioSampleRate");
          if (value.isNumber()) {
            audioSampleRate = value.asNumber();
          }
        }
        if (options.hasProperty(runtime, "audioChannelCount")) {
          auto value = options.getProperty(runtime, "audioChannelCount");
          if (value.isNumber()) {
            audioChannelCount = value.asNumber();
          }
        }

        std::shared_ptr<VideoComposition> composition = nullptr;
        if (count >= 2 && arguments[1].isObject()) {
          auto jsComposition = arguments[1].asObject(runtime);
          composition = VideoComposition::fromJS(runtime, jsComposition);
        }

        auto instance = std::make_shared<VideoEncoderHostObject>(
            outPath, width, height, frameRate, bitRate, audioBitRate,
            audioSampleRate, audioChannelCount, composition);
        return jsi::Object::createFromHostObject(runtime, instance);
      });
  RNSVModule.setProperty(runtime, "createVideoEncoder",
                         std::move(createVideoEncoder));

  runtime.global().setProperty(runtime, "RNSkiaVideo", RNSVModule);
  return @true;
}
- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams&)params {
  return std::make_shared<facebook::react::NativeReactNativeSkiaVideoSpecJSI>(
      params);
}

@end
