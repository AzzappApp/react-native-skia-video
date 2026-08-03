#include "VideoCompositionFramesExtractorHostObject.h"

#import "AVAssetTrackUtils.h"
#import "AudioCompositionUtils.h"
#import "JSIUtils.h"
#import <AVFoundation/AVFoundation.h>
#import <Foundation/Foundation.h>
#import <future>

namespace RNSkiaVideo {

VideoCompositionFramesExtractorHostObject::
    VideoCompositionFramesExtractorHostObject(
        jsi::Runtime& runtime, std::shared_ptr<react::CallInvoker> callInvoker,
        std::shared_ptr<VideoComposition> videoComposition)
    : EventEmitter(runtime, callInvoker), composition(videoComposition) {
  lock = [[NSObject alloc] init];
}

VideoCompositionFramesExtractorHostObject::
    ~VideoCompositionFramesExtractorHostObject() {
  this->release();
}

std::vector<jsi::PropNameID>
VideoCompositionFramesExtractorHostObject::getPropertyNames(jsi::Runtime& rt) {
  std::vector<jsi::PropNameID> result;
  result.push_back(jsi::PropNameID::forUtf8(rt, std::string("prepare")));
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
  if (propName == "prepare") {
    return jsi::Function::createFromHostFunction(
        runtime, jsi::PropNameID::forAscii(runtime, "prepare"), 0,
        [this](jsi::Runtime& runtime, const jsi::Value& thisValue,
               const jsi::Value* arguments, size_t count) -> jsi::Value {
          if (!released.test()) {
            prepare();
          }
          return jsi::Value::undefined();
        });
  } else if (propName == "play") {
    return jsi::Function::createFromHostFunction(
        runtime, jsi::PropNameID::forAscii(runtime, "play"), 0,
        [this](jsi::Runtime& runtime, const jsi::Value& thisValue,
               const jsi::Value* arguments, size_t count) -> jsi::Value {
          if (!released.test()) {
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
          if (!released.test()) {
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
          if (!released.test()) {
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
            if (released.test() || !initialized) {
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
            if (released.test()) {
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
    return jsi::Value(released.test() ? 0 : CMTimeGetSeconds(getCurrentTime()));
  } else if (propName == "isLooping") {
    return jsi::Value(!released.test() && isLooping);
  } else if (propName == "isPlaying") {
    return jsi::Value(!released.test() && isPlaying);
  }
  return jsi::Value::undefined();
}

void VideoCompositionFramesExtractorHostObject::set(
    jsi::Runtime& runtime, const jsi::PropNameID& propNameId,
    const jsi::Value& value) {
  if (released.test()) {
    return;
  }
  auto propName = propNameId.utf8(runtime);
  if (propName == "isLooping") {
    isLooping = value.asBool();
  }
}

void VideoCompositionFramesExtractorHostObject::prepare() {
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
            if (released.test() || !initialized) {
              return;
            }
            auto currentTime = getCurrentTime();
            if (CMTimeGetSeconds(currentTime) >= composition->duration) {
              if (!completeEmitted) {
                completeEmitted = true;
                emit("complete", jsi::Value::null());
              }
              if (isLooping) {
                currentTime = kCMTimeZero;
                startDate = [NSDate date];
                if (audioPlayer) {
                  [audioPlayer seekToTime:kCMTimeZero
                          toleranceBefore:kCMTimeZero
                           toleranceAfter:kCMTimeZero
                        completionHandler:^(BOOL){
                        }];
                }
              } else {
                isPlaying = false;
                if (audioPlayer) {
                  [audioPlayer pause];
                }
                return;
              }
            } else {
              completeEmitted = false;
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
void VideoCompositionFramesExtractorHostObject::init() {
  @synchronized(lock) {
    if (released.test()) {
      return;
    }
    try {
      // Assets are shared between the video decoders and the audio
      // composition so a same file is never opened twice.
      NSMutableDictionary<NSString*, AVURLAsset*>* assetCache =
          [NSMutableDictionary dictionary];
      for (const auto& item : composition->items) {
        if (!item->isVideo) {
          continue;
        }
        itemDecoders[item->id] = std::make_shared<VideoCompositionItemDecoder>(
            item, true, getOrCreateAsset(item->path, assetCache));
      }
      if (composition->hasAudio()) {
        auto audioComposition = buildAudioComposition(composition, assetCache);
        if (audioComposition.composition) {
          AVPlayerItem* playerItem =
              [AVPlayerItem playerItemWithAsset:audioComposition.composition];
          if (audioComposition.audioMix) {
            playerItem.audioMix = audioComposition.audioMix;
          }
          audioPlayer = [AVPlayer playerWithPlayerItem:playerItem];
          audioPlayer.actionAtItemEnd = AVPlayerActionAtItemEndNone;
          audioPlayer.automaticallyWaitsToMinimizeStalling = NO;
          if (CMTimeCompare(pausePosition, kCMTimeZero) > 0) {
            [audioPlayer seekToTime:pausePosition
                    toleranceBefore:kCMTimeZero
                     toleranceAfter:kCMTimeZero];
          }
        }
      }
    } catch (NSError* error) {
      itemDecoders.clear();
      audioPlayer = nil;
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
  if (audioPlayer) {
    if (CMTimeGetSeconds(audioPlayer.currentTime) >= composition->duration) {
      [audioPlayer seekToTime:kCMTimeZero
              toleranceBefore:kCMTimeZero
               toleranceAfter:kCMTimeZero];
    }
    [audioPlayer play];
  }
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
  if (audioPlayer) {
    [audioPlayer pause];
  }
}

void VideoCompositionFramesExtractorHostObject::seekTo(CMTime time) {
  if (isPlaying) {
    startDate = [NSDate dateWithTimeIntervalSinceNow:-CMTimeGetSeconds(time)];
  } else {
    pausePosition = time;
  }
  if (audioPlayer) {
    [audioPlayer seekToTime:time
            toleranceBefore:kCMTimeZero
             toleranceAfter:kCMTimeZero];
  }
  @synchronized(lock) {
    for (const auto& entry : itemDecoders) {
      entry.second->seekTo(time);
    }
  }
}

CMTime VideoCompositionFramesExtractorHostObject::getCurrentTime() {
  if (isPlaying) {
    // When the composition has audio, the audio player is the master clock.
    if (audioPlayer) {
      CMTime time = audioPlayer.currentTime;
      if (CMTIME_IS_NUMERIC(time)) {
        return time;
      }
    }
    NSTimeInterval elapsedTime =
        [[NSDate date] timeIntervalSinceDate:startDate];
    return CMTimeMakeWithSeconds(elapsedTime, NSEC_PER_SEC);
  } else {
    return pausePosition;
  }
}

void VideoCompositionFramesExtractorHostObject::release() {
  @synchronized(lock) {
    if (released.test_and_set()) {
      return;
    }
    try {
      for (const auto& entry : itemDecoders) {
        auto decoder = entry.second;
        if (decoder) {
          entry.second->release();
        }
      }
    } catch (...) {
    }
    itemDecoders.clear();
    currentFrames.clear();
    if (audioPlayer) {
      [audioPlayer pause];
      [audioPlayer replaceCurrentItemWithPlayerItem:nil];
      audioPlayer = nil;
    }
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
