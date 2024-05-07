//
//  VideoPlayerHostObject.m
//  azzapp-react-native-skia-video
//
//  Created by François de Campredon on 03/05/2024.
//

#import "VideoPlayerHostObject.h"
#import "JSIUtils.h"

namespace RNSkiaVideo {
using namespace facebook;

VideoPlayerHostObject::VideoPlayerHostObject(
    jsi::Runtime& runtime, std::shared_ptr<react::CallInvoker> callInvoker,
    NSURL* url)
    : EventEmitter(runtime, callInvoker) {
  playerDelegate =
      [[RNSVSkiaVideoPlayerDelegateImpl alloc] initWithHost:this
                                                    runtime:&runtime];
  player = [[RNSVVideoPlayer alloc] initWithURL:url delegate:playerDelegate];
}

VideoPlayerHostObject::~VideoPlayerHostObject() {
  release();
}

std::vector<jsi::PropNameID>
VideoPlayerHostObject::getPropertyNames(jsi::Runtime& rt) {
  std::vector<jsi::PropNameID> result;
  result.push_back(
      jsi::PropNameID::forUtf8(rt, std::string("decodeNextFrame")));
  result.push_back(jsi::PropNameID::forUtf8(rt, std::string("play")));
  result.push_back(jsi::PropNameID::forUtf8(rt, std::string("pause")));
  result.push_back(jsi::PropNameID::forUtf8(rt, std::string("seekTo")));
  result.push_back(jsi::PropNameID::forUtf8(rt, std::string("currentTime")));
  result.push_back(jsi::PropNameID::forUtf8(rt, std::string("duration")));
  result.push_back(jsi::PropNameID::forUtf8(rt, std::string("volume")));
  result.push_back(jsi::PropNameID::forUtf8(rt, std::string("isLooping")));
  result.push_back(jsi::PropNameID::forUtf8(rt, std::string("isPlaying")));
  result.push_back(jsi::PropNameID::forUtf8(rt, std::string("dispose")));
  result.push_back(jsi::PropNameID::forUtf8(rt, std::string("on")));
  return result;
}

jsi::Value VideoPlayerHostObject::get(jsi::Runtime& runtime,
                                      const jsi::PropNameID& propNameId) {
  auto propName = propNameId.utf8(runtime);
  if (propName == "decodeNextFrame") {
    return jsi::Function::createFromHostFunction(
        runtime, jsi::PropNameID::forAscii(runtime, "decodeNextFrame"), 0,
        [this](jsi::Runtime& runtime, const jsi::Value& thisValue,
               const jsi::Value* arguments, size_t count) -> jsi::Value {
          if (released.test() || !CMTIME_IS_VALID(lastFrameAvailable) ||
              lastFrameDrawn.value == lastFrameAvailable.value) {
            return jsi::Value::null();
          }
          auto buffer = [player copyPixelBufferForTime:lastFrameAvailable];
          if (buffer == nil) {
            return jsi::Value::null();
          }
          lastFrameDrawn = lastFrameAvailable;
          if (currentBuffer != nullptr) {
            CVBufferRelease(currentBuffer);
          }
          currentBuffer = buffer;

          auto frame = jsi::Object(runtime);
          frame.setProperty(runtime, "width", jsi::Value(this->width));
          frame.setProperty(runtime, "height", jsi::Value(this->height));
          frame.setProperty(runtime, "rotation", jsi::Value(this->rotation));
          frame.setProperty(
              runtime, "buffer",
              jsi::BigInt::fromUint64(
                  runtime, reinterpret_cast<uintptr_t>(currentBuffer)));

          return frame;
        });
  } else if (propName == "play") {
    return jsi::Function::createFromHostFunction(
        runtime, jsi::PropNameID::forAscii(runtime, "play"), 0,
        [this](jsi::Runtime& runtime, const jsi::Value& thisValue,
               const jsi::Value* arguments, size_t count) -> jsi::Value {
          if (!released.test()) {
            [player play];
          }
          return jsi::Value::undefined();
        });
  } else if (propName == "pause") {
    return jsi::Function::createFromHostFunction(
        runtime, jsi::PropNameID::forAscii(runtime, "pause"), 0,
        [this](jsi::Runtime& runtime, const jsi::Value& thisValue,
               const jsi::Value* arguments, size_t count) -> jsi::Value {
          if (!released.test()) {
            [player pause];
          }
          return jsi::Value::undefined();
        });
  } else if (propName == "seekTo") {
    return jsi::Function::createFromHostFunction(
        runtime, jsi::PropNameID::forAscii(runtime, "seekTo"), 1,
        [this](jsi::Runtime& runtime, const jsi::Value& thisValue,
               const jsi::Value* arguments, size_t count) -> jsi::Value {
          if (!released.test()) {
            auto time = arguments[0].asNumber();
            [player seekTo:CMTimeMakeWithSeconds(time, 600)
                completionHandler:^(BOOL) {
                  if (!released.test()) {
                    this->emit("seekComplete", jsi::Value::null());
                  }
                }];
          }
          return jsi::Value::undefined();
        });
  } else if (propName == "on") {
    return jsi::Function::createFromHostFunction(
        runtime, jsi::PropNameID::forAscii(runtime, "on"), 2,
        [this](jsi::Runtime& runtime, const jsi::Value& thisValue,
               const jsi::Value* arguments, size_t count) -> jsi::Value {
          if (released.test()) {
            return jsi::Function::createFromHostFunction(
                runtime, jsi::PropNameID::forAscii(runtime, "on"), 2,
                [this](jsi::Runtime& runtime, const jsi::Value& thisValue,
                       const jsi::Value* arguments,
                       size_t count) -> jsi::Value {
                  return jsi::Value::undefined();
                });
          }
          auto name = arguments[0].asString(runtime).utf8(runtime);
          auto handler = arguments[1].asObject(runtime).asFunction(runtime);
          return this->on(name, std::move(handler));
        });
  } else if (propName == "dispose") {
    return jsi::Function::createFromHostFunction(
        runtime, jsi::PropNameID::forAscii(runtime, "dispose"), 0,
        [this](jsi::Runtime& runtime, const jsi::Value& thisValue,
               const jsi::Value* arguments, size_t count) -> jsi::Value {
          this->release();
          return jsi::Value::undefined();
        });
  } else if (propName == "currentTime") {
    if (released.test()) {
      return jsi::Value(0);
    }
    double seconds = CMTimeGetSeconds(player.currentTime);
    return jsi::Value(isnan(seconds) ? -1 : seconds);
  } else if (propName == "duration") {
    if (released.test()) {
      return jsi::Value(0);
    }
    double seconds = CMTimeGetSeconds(player.duration);
    return jsi::Value(isnan(seconds) ? -1 : seconds);
  } else if (propName == "volume") {
    if (released.test()) {
      return jsi::Value(0);
    }
    float volume = player.volume;
    return jsi::Value(volume);
  } else if (propName == "isLooping") {
    if (released.test()) {
      return jsi::Value(false);
    }
    return jsi::Value(player.isLooping);
  } else if (propName == "isPlaying") {
    if (released.test()) {
      return jsi::Value(false);
    }
    return jsi::Value(player.isPlaying);
  }

  return jsi::Value::undefined();
}

void VideoPlayerHostObject::set(jsi::Runtime& runtime,
                                const jsi::PropNameID& propNameId,
                                const jsi::Value& value) {
  if (released.test()) {
    return;
  }
  auto propName = propNameId.utf8(runtime);
  if (propName == "volume") {
    player.volume = value.asNumber();
  } else if (propName == "isLooping") {
    player.isLooping = value.asBool();
  }
}

void VideoPlayerHostObject::frameAvailableEventHandler(CMTime time) {
  lastFrameAvailable = time;
}

void VideoPlayerHostObject::readyToPlay(float width, float height,
                                        int rotation) {
  this->width = width;
  this->height = height;
  this->rotation = rotation;
}

void VideoPlayerHostObject::release() {
  if (!released.test_and_set()) {
    removeAllListeners();
    if (currentBuffer != nullptr) {
      CVBufferRelease(currentBuffer);
    }
    currentBuffer = nullptr;
    [playerDelegate dispose];
    playerDelegate = nullptr;
    [player dispose];
    player = nullptr;
  }
}

} // namespace RNSkiaVideo

using namespace facebook;

@implementation RNSVSkiaVideoPlayerDelegateImpl {
  RNSkiaVideo::EventEmitter* _host;
  const jsi::Runtime* _runtime;
}

- (instancetype)initWithHost:(RNSkiaVideo::EventEmitter*)host
                     runtime:(jsi::Runtime*)runtime {
  self = [super init];
  _host = host;
  _runtime = runtime;
  return self;
}

- (void)readyToPlay:(NSDictionary*)assetInfos {
  float width = [(NSNumber*)assetInfos[@"width"] floatValue];
  float height = [(NSNumber*)assetInfos[@"height"] floatValue];
  int rotation = [(NSNumber*)assetInfos[@"width"] intValue];
  ((RNSkiaVideo::VideoPlayerHostObject*)_host)
      ->readyToPlay(width, height, rotation);
  _host->emit("ready", [=](jsi::Runtime& runtime) -> jsi::Value {
    auto res = jsi::Object(runtime);
    res.setProperty(runtime, "width", jsi::Value(width));
    res.setProperty(runtime, "height", jsi::Value(height));
    res.setProperty(runtime, "rotation", jsi::Value(rotation));
    return res;
  });
}

- (void)frameAvailable:(CMTime)time {
  ((RNSkiaVideo::VideoPlayerHostObject*)_host)
      ->frameAvailableEventHandler(time);
}

- (void)bufferingStart {
  _host->emit("bufferingStart");
}

- (void)bufferingEnd {
  _host->emit("bufferingEnd");
}

- (void)bufferingUpdate:(NSArray<NSValue*>*)loadedTimeRanges {
  _host->emit("bufferingUpdate", [=](jsi::Runtime& runtime) -> jsi::Value {
    auto ranges = jsi::Array(runtime, loadedTimeRanges.count);
    for (NSValue* value in loadedTimeRanges) {
      CMTimeRange timeRange = [value CMTimeRangeValue];
      auto range = jsi::Object(runtime);
      range.setProperty(runtime, "start",
                        jsi::Value(CMTimeGetSeconds(timeRange.start)));
      range.setProperty(runtime, "duration",
                        jsi::Value(CMTimeGetSeconds(timeRange.duration)));
    };
    return ranges;
  });
}

- (void)videoError:(nullable NSError*)error {
  _host->emit("error", [=](jsi::Runtime& runtime) -> jsi::Value {
    auto jsError = jsi::Object(runtime);
    auto message = error == nil ? @"Unknown error" : [error description];
    jsError.setProperty(
        runtime, "message",
        jsi::String::createFromUtf8(runtime, [message UTF8String]));
    jsError.setProperty(runtime, "code",
                        error != nil ? jsi::Value((double)[error code])
                                     : jsi::Value::null());
    return jsError;
  });
}

- (void)complete {
  _host->emit("complete");
}

- (void)isPlaying:(Boolean)playing {
  _host->emit("playingStatusChange", jsi::Value(playing));
}

- (void)dispose {
  _host = nil;
}

@end