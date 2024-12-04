#import "ReactNativeSkiaVideo.h"

#import "RNskiaModule.h"
#import <React/RCTBridge+Private.h>
#import <React/RCTBridge.h>
#import <React/RCTUtils.h>
#import <ReactCommon/RCTTurboModule.h>
#import <jsi/jsi.h>

#import "JSIUtils.h"
#import "VideoComposition.h"
#import "VideoCompositionFramesExtractorHostObject.h"
#import "VideoCompositionFramesExtractorSyncHostObject.h"
#import "VideoEncoderHostObject.h"
#import "VideoPlayerHostObject.h"

@implementation ReactNativeSkiaVideo
RCT_EXPORT_MODULE()
RCT_EXPORT_BLOCKING_SYNCHRONOUS_METHOD(install) {
  RCTBridge* bridge = [RCTBridge currentBridge];
  RCTCxxBridge* cxxBridge = (RCTCxxBridge*)bridge;
  if (cxxBridge == nil) {
    return @false;
  }

  using namespace facebook;

  auto jsiRuntime = (jsi::Runtime*)cxxBridge.runtime;
  if (jsiRuntime == nil) {
    return @false;
  }
  auto& runtime = *jsiRuntime;
  auto RNSVModule = jsi::Object(runtime);

  auto createVideoPlayer = jsi::Function::createFromHostFunction(
      runtime, jsi::PropNameID::forAscii(runtime, "createVideoPlayer"), 2,
      [bridge](jsi::Runtime& runtime, const jsi::Value& thisValue,
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

        auto instance = std::make_shared<RNSkiaVideo::VideoPlayerHostObject>(
            runtime, bridge.jsCallInvoker, url, resolution);
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
          [bridge](jsi::Runtime& runtime, const jsi::Value& thisValue,
                   const jsi::Value* arguments, size_t count) -> jsi::Value {
            if (count != 1 || !arguments[0].isObject()) {
              throw jsi::JSError(runtime,
                                 "ReactNativeSkiaVideo."
                                 "createVideoCompositionFramesExtractor(.."
                                 ") expects one arguments (object)!");
            }

            auto instance = std::make_shared<
                RNSkiaVideo::VideoCompositionFramesExtractorHostObject>(
                runtime, bridge.jsCallInvoker, arguments[0].asObject(runtime));
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
          [bridge](jsi::Runtime& runtime, const jsi::Value& thisValue,
                   const jsi::Value* arguments, size_t count) -> jsi::Value {
            if (count != 1 || !arguments[0].isObject()) {
              throw jsi::JSError(runtime,
                                 "ReactNativeSkiaVideo."
                                 "createVideoCompositionFramesExtractorSync(..)"
                                 " expects one arguments (object)!");
            }

            auto instance = std::make_shared<
                RNSkiaVideo::VideoCompositionFramesExtractorSyncHostObject>(
                runtime, arguments[0].asObject(runtime));
            return jsi::Object::createFromHostObject(runtime, instance);
          });

  RNSVModule.setProperty(runtime, "createVideoCompositionFramesExtractorSync",
                         std::move(createVideoCompositionFramesExtractorSync));

  auto createVideoEncoder = jsi::Function::createFromHostFunction(
      runtime, jsi::PropNameID::forAscii(runtime, "createVideoEncoder"), 1,
      [bridge](jsi::Runtime& runtime, const jsi::Value& thisValue,
               const jsi::Value* arguments, size_t count) -> jsi::Value {
        if (count != 1 || !arguments[0].isObject()) {
          throw jsi::JSError(runtime, "ReactNativeSkiaVideo.createVideoEncoder("
                                      "..) expects one arguments (object)!");
        }

        auto options = arguments[0].asObject(runtime);
        auto outPath = options.getProperty(runtime, "outPath")
                           .asString(runtime)
                           .utf8(runtime);
        int width = options.getProperty(runtime, "width").asNumber();
        int height = options.getProperty(runtime, "height").asNumber();
        int frameRate = options.getProperty(runtime, "frameRate").asNumber();
        int bitRate = options.getProperty(runtime, "bitRate").asNumber();

        auto instance = std::make_shared<RNSkiaVideo::VideoEncoderHostObject>(
            outPath, width, height, frameRate, bitRate);
        return jsi::Object::createFromHostObject(runtime, instance);
      });
  RNSVModule.setProperty(runtime, "createVideoEncoder",
                         std::move(createVideoEncoder));

  runtime.global().setProperty(runtime, "RNSkiaVideo", RNSVModule);
  return @true;
}
// Don't compile this code when we build for the old architecture.
#ifdef RCT_NEW_ARCH_ENABLED
- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams&)params {
  return std::make_shared<facebook::react::NativeReactNativeSkiaVideoSpecJSI>(
      params);
}
#endif

@end
