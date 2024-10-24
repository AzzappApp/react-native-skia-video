#include "VideoCompositionFramesExtractorHostObject.h"

#import "AVAssetTrackUtils.h"
#import "JSIUtils.h"
#import <AVFoundation/AVFoundation.h>
#import <Foundation/Foundation.h>
#import <future>

namespace RNSkiaVideo {

VideoCompositionFramesExtractorHostObject::
    VideoCompositionFramesExtractorHostObject(
        jsi::Runtime& runtime, std::shared_ptr<react::CallInvoker> callInvoker,
        jsi::Object jsComposition)
    : EventEmitter(runtime, callInvoker) {
  lock = [[NSObject alloc] init];
  composition = VideoComposition::fromJS(runtime, jsComposition);

  dispatch_queue_attr_t attr = dispatch_queue_attr_make_with_qos_class(
      DISPATCH_QUEUE_SERIAL, QOS_CLASS_UTILITY, 0);
  decoderQueue =
      dispatch_queue_create("ReactNativeVideoCompositionItemDecoder", attr);
  dispatch_async(decoderQueue, ^{
    this->init();
  });

  displayLink = [[RNSVDisplayLinkWrapper alloc]
      initWithUpdateBlock:^(CADisplayLink* displayLink) {
        dispatch_async(decoderQueue, ^{
          std::vector<std::future<void>> futures;
          @synchronized(lock) {
            if (released || !initialized) {
              return;
            }
            auto currentTime = getCurrentTime();
            if (CMTimeGetSeconds(currentTime) >= composition->duration) {
              emit("complete", jsi::Value::null());
              if (isLooping) {
                currentTime = kCMTimeZero;
                startDate = [NSDate date];
              } else {
                isPlaying = false;
                return;
              }
            }
            for (const auto& entry : itemDecoders) {
              auto decoder = entry.second;
              if (decoder) {
                futures.push_back(
                    std::async(std::launch::async, [decoder, currentTime]() {
                      decoder->advanceDecoder(currentTime);
                    }));
              }
            }
          }
          for (auto& future : futures) {
            future.get();
          }
        });
      }];
  [displayLink start];
}

VideoCompositionFramesExtractorHostObject::
    ~VideoCompositionFramesExtractorHostObject() {
  this->release();
}

std::vector<jsi::PropNameID>
VideoCompositionFramesExtractorHostObject::getPropertyNames(jsi::Runtime& rt) {
  std::vector<jsi::PropNameID> result;
  result.push_back(jsi::PropNameID::forUtf8(rt, std::string("play")));
  result.push_back(jsi::PropNameID::forUtf8(rt, std::string("pause")));
  result.push_back(jsi::PropNameID::forUtf8(rt, std::string("seekTo")));
  result.push_back(
      jsi::PropNameID::forUtf8(rt, std::string("decodeCompositionFrames")));
  result.push_back(jsi::PropNameID::forUtf8(rt, std::string("on")));
  result.push_back(jsi::PropNameID::forUtf8(rt, std::string("dispose")));
  result.push_back(jsi::PropNameID::forUtf8(rt, std::string("currentTime")));
  result.push_back(jsi::PropNameID::forUtf8(rt, std::string("isLooping")));
  result.push_back(jsi::PropNameID::forUtf8(rt, std::string("isPlaying")));
  return result;
}

jsi::Value VideoCompositionFramesExtractorHostObject::get(
    jsi::Runtime& runtime, const jsi::PropNameID& propNameId) {
  auto propName = propNameId.utf8(runtime);
  if (propName == "play") {
    return jsi::Function::createFromHostFunction(
        runtime, jsi::PropNameID::forAscii(runtime, "play"), 0,
        [this](jsi::Runtime& runtime, const jsi::Value& thisValue,
               const jsi::Value* arguments, size_t count) -> jsi::Value {
          if (!released) {
            if (initialized) {
              play();
            } else {
              playWhenReady = true;
            }
          }
          return jsi::Value::undefined();
        });
  } else if (propName == "pause") {
    return jsi::Function::createFromHostFunction(
        runtime, jsi::PropNameID::forAscii(runtime, "pause"), 0,
        [this](jsi::Runtime& runtime, const jsi::Value& thisValue,
               const jsi::Value* arguments, size_t count) -> jsi::Value {
          if (!released) {
            if (initialized) {
              pause();
            } else {
              playWhenReady = false;
            }
          }
          return jsi::Value::undefined();
        });
  } else if (propName == "seekTo") {
    return jsi::Function::createFromHostFunction(
        runtime, jsi::PropNameID::forAscii(runtime, "seekTo"), 1,
        [this](jsi::Runtime& runtime, const jsi::Value& thisValue,
               const jsi::Value* arguments, size_t count) -> jsi::Value {
          if (!released) {
            seekTo(
                CMTimeMakeWithSeconds(arguments[0].asNumber(), NSEC_PER_SEC));
          }
          return jsi::Value::undefined();
        });
  } else if (propName == "decodeCompositionFrames") {
    return jsi::Function::createFromHostFunction(
        runtime, jsi::PropNameID::forAscii(runtime, "decodeCompositionFrames"),
        0,
        [this](jsi::Runtime& runtime, const jsi::Value& thisValue,
               const jsi::Value* arguments, size_t count) -> jsi::Value {
          @synchronized(lock) {
            auto frames = jsi::Object(runtime);
            if (released || !initialized) {
              return frames;
            }
            auto currentTime = getCurrentTime();
            for (const auto& entry : itemDecoders) {
              auto itemId = entry.first;
              auto decoder = entry.second;

              auto previousFrame = currentFrames[itemId];
              auto frame =
                  decoder->acquireFrameForTime(currentTime, !previousFrame);
              if (frame) {
                if (previousFrame) {
                  previousFrame->release();
                }
                currentFrames[itemId] = frame;
              } else {
                frame = previousFrame;
              }
              if (frame) {
                frames.setProperty(
                    runtime, entry.first.c_str(),
                    jsi::Object::createFromHostObject(runtime, frame));
              }
            }
            return frames;
          }
        });
  } else if (propName == "on") {
    return jsi::Function::createFromHostFunction(
        runtime, jsi::PropNameID::forAscii(runtime, "on"), 2,
        [this](jsi::Runtime& runtime, const jsi::Value& thisValue,
               const jsi::Value* arguments, size_t count) -> jsi::Value {
          @synchronized(lock) {
            if (released) {
              return jsi::Function::createFromHostFunction(
                  runtime, jsi::PropNameID::forAscii(runtime, "on"), 2,
                  [](jsi::Runtime& runtime, const jsi::Value& thisValue,
                     const jsi::Value* arguments, size_t count) -> jsi::Value {
                    return jsi::Value::undefined();
                  });
            }
            auto name = arguments[0].asString(runtime).utf8(runtime);
            auto handler = arguments[1].asObject(runtime).asFunction(runtime);
            return this->on(name, std::move(handler));
          }
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
    return jsi::Value(released ? 0 : CMTimeGetSeconds(getCurrentTime()));
  } else if (propName == "isLooping") {
    return jsi::Value(!released && isLooping);
  } else if (propName == "isPlaying") {
    return jsi::Value(!released && isPlaying);
  }
  return jsi::Value::undefined();
}

void VideoCompositionFramesExtractorHostObject::set(
    jsi::Runtime& runtime, const jsi::PropNameID& propNameId,
    const jsi::Value& value) {
  if (released) {
    return;
  }
  auto propName = propNameId.utf8(runtime);
  if (propName == "isLooping") {
    isLooping = value.asBool();
  }
}

void VideoCompositionFramesExtractorHostObject::init() {
  @synchronized(lock) {
    if (released) {
      return;
    }
    try {
      for (const auto& item : composition->items) {
        itemDecoders[item->id] =
            std::make_shared<VideoCompositionItemDecoder>(item, true);
      }
    } catch (NSError* error) {
      itemDecoders.clear();
      emit("error", [=](jsi::Runtime& runtime) -> jsi::Value {
        return RNSkiaVideo::NSErrorToJSI(runtime, error);
      });
      return;
    }
    initialized = true;
    if (playWhenReady) {
      play();
    }
    this->emit("ready", jsi::Value::null());
  }
}

void VideoCompositionFramesExtractorHostObject::play() {
  startDate =
      [NSDate dateWithTimeIntervalSinceNow:-CMTimeGetSeconds(pausePosition)];
  pausePosition = kCMTimeZero;
  isPlaying = true;
}

void VideoCompositionFramesExtractorHostObject::pause() {
  if (!isPlaying) {
    return;
  }
  pausePosition = getCurrentTime();
  isPlaying = false;
}

void VideoCompositionFramesExtractorHostObject::seekTo(CMTime time) {
  if (isPlaying) {
    startDate = [NSDate dateWithTimeIntervalSinceNow:-CMTimeGetSeconds(time)];
  } else {
    pausePosition = time;
  }
  @synchronized(lock) {
    for (const auto& entry : itemDecoders) {
      entry.second->seekTo(time);
    }
  }
}

CMTime VideoCompositionFramesExtractorHostObject::getCurrentTime() {
  if (isPlaying) {
    NSTimeInterval elapsedTime =
        [[NSDate date] timeIntervalSinceDate:startDate];
    return CMTimeMakeWithSeconds(elapsedTime, NSEC_PER_SEC);
  } else {
    return pausePosition;
  }
}

void VideoCompositionFramesExtractorHostObject::release() {
  @synchronized(lock) {
    if (released) {
      return;
    }
    try {
      for (const auto& entry : itemDecoders) {
        auto decoder = entry.second;
        if (decoder) {
          entry.second->release();
        }
      }
      for (const auto& entry : currentFrames) {
        auto frame = entry.second;
        if (frame) {
          frame->release();
        }
      }
    } catch (...) {
    }
    itemDecoders.clear();
    currentFrames.clear();
  }
  removeAllListeners();
  if (displayLink != nullptr) {
    [displayLink invalidate];
    displayLink = nullptr;
  }
}

} // namespace RNSkiaVideo

@implementation RNSVDisplayLinkWrapper

- (instancetype)initWithUpdateBlock:
    (void (^)(CADisplayLink* displayLink))updateBlock {
  self = [super init];
  if (self) {
    _updateBlock = [updateBlock copy];
    _displayLink =
        [CADisplayLink displayLinkWithTarget:self
                                    selector:@selector(displayLinkFired:)];
  }
  return self;
}

- (void)displayLinkFired:(CADisplayLink*)displayLink {
  if (self.updateBlock) {
    self.updateBlock(displayLink);
  }
}

- (void)start {
  [self.displayLink addToRunLoop:[NSRunLoop mainRunLoop]
                         forMode:NSRunLoopCommonModes];
}

- (void)invalidate {
  [self.displayLink invalidate];
  self.displayLink = nil;
}

@end
