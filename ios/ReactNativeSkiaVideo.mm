#import "ReactNativeSkiaVideo.h"

#import <RNskiaModule.h>
#import <React/RCTBridge+Private.h>
#import <React/RCTBridge.h>
#import <React/RCTUtils.h>
#import <ReactCommon/RCTTurboModule.h>
#import <worklets/WorkletRuntime/WorkletRuntime.h>
#import <jsi/jsi.h>

#import "JSIUtils.h"
#import "VideoComposition.h"
#import "VideoCompositionExporter.h"
#import "VideoCompositionFramesExtractorHostObject.h"
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

  auto exportVideoComposition = jsi::Function::createFromHostFunction(
      runtime, jsi::PropNameID::forAscii(runtime, "exportVideoComposition"), 6,
      [](jsi::Runtime& runtime, const jsi::Value& thisValue,
         const jsi::Value* arguments, size_t count) -> jsi::Value {
        if (count < 6) {
          throw jsi::JSError(runtime,
                             "SkiaVideo.exportVideoComposition(..) expects 4"
                             "arguments (composition, options, workletRuntime, "
                             "drawFrame, onSuccess, onError, onProgress?)!");
        }
        auto bridge = [RCTBridge currentBridge];
        RNSkiaModule* skiaModule = [bridge moduleForName:@"RNSkiaModule"];
        auto rnskPlatformContext =
            skiaModule.manager.skManager->getPlatformContext();
        auto callInvoker = bridge.jsCallInvoker;

        auto jsCompositon = arguments[0].asObject(runtime);
        auto composition =
            RNSkiaVideo::VideoComposition::fromJS(runtime, jsCompositon);

        auto options = arguments[1].asObject(runtime);
        auto outPath = options.getProperty(runtime, "outPath")
                           .asString(runtime)
                           .utf8(runtime);
        int width = options.getProperty(runtime, "width").asNumber();
        int height = options.getProperty(runtime, "height").asNumber();
        int frameRate = options.getProperty(runtime, "frameRate").asNumber();
        int bitRate = options.getProperty(runtime, "bitRate").asNumber();
        auto workletRuntime =
            worklets::extractWorkletRuntime(runtime, arguments[2]);
        auto drawFrame =
            worklets::extractShareableOrThrow<worklets::ShareableWorklet>(
                runtime, arguments[3]);

        auto sharedSuccessCallback = std::make_shared<jsi::Function>(
            arguments[4].asObject(runtime).asFunction(runtime));
        auto sharedErrorCallback = std::make_shared<jsi::Function>(
            arguments[5].asObject(runtime).asFunction(runtime));

        std::shared_ptr<jsi::Function> sharedProgressCallback = nullptr;
        if (count >= 7 && arguments[6].isObject()) {
          sharedProgressCallback = std::make_shared<jsi::Function>(
              arguments[6].asObject(runtime).asFunction(runtime));
        }

        auto queue =
            dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_DEFAULT, 0);
        dispatch_async(queue, ^{
          RNSkiaVideo::exportVideoComposition(
              composition, outPath, width, height, frameRate, bitRate,
              workletRuntime, drawFrame, rnskPlatformContext,
              [callInvoker, &runtime, sharedSuccessCallback]() {
                callInvoker->invokeAsync(
                    [&runtime, sharedSuccessCallback]() -> void {
                      sharedSuccessCallback->call(runtime);
                    });
              },
              [callInvoker, &runtime, sharedErrorCallback](NSError* error) {
                callInvoker->invokeAsync(
                    [&runtime, error, sharedErrorCallback]() -> void {
                      sharedErrorCallback->call(
                          runtime, RNSkiaVideo::NSErrorToJSI(runtime, error));
                    });
              },
              [callInvoker, &runtime, sharedProgressCallback](int progress) {
                callInvoker->invokeAsync([&runtime, progress,
                                          sharedProgressCallback]() -> void {
                  if (sharedProgressCallback != nullptr) {
                    sharedProgressCallback->call(runtime, jsi::Value(progress));
                  }
                });
              });
        });

        return jsi::Value::undefined();
      });
  RNSVModule.setProperty(runtime, "exportVideoComposition",
                         std::move(exportVideoComposition));

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
