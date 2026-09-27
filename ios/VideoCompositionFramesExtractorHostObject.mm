#include "VideoCompositionFramesExtractorHostObject.h"

#import "AVAssetTrackUtils.h"
#import "AudioCompositionUtils.h"
#import "RNSVJSIUtils.h"
#import <AVFoundation/AVFoundation.h>
#import <Foundation/Foundation.h>

namespace RNSkiaVideo {

VideoCompositionFramesExtractorHostObject::
    VideoCompositionFramesExtractorHostObject(
        jsi::Runtime& runtime, std::shared_ptr<react::CallInvoker> callInvoker,
        std::shared_ptr<VideoComposition> videoComposition)
    : EventEmitter(runtime, callInvoker), composition(videoComposition),
      window(videoComposition->lazyDecoders, true) {
  lock = [[NSObject alloc] init];
}

VideoCompositionFramesExtractorHostObject::
    ~VideoCompositionFramesExtractorHostObject() {
  this->release();
  // The queued blocks hold this, a reader being opened among them: this
  // returns once they have all run.
  if (decoderQueue) {
    dispatch_sync(decoderQueue, ^{
      return;
    });
  }
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
  result.push_back(jsi::PropNameID::forUtf8(rt, std::string("framesVersion")));
  result.push_back(jsi::PropNameID::forUtf8(rt, std::string("isLooping")));
  result.push_back(jsi::PropNameID::forUtf8(rt, std::string("isPlaying")));
  return result;
}

// The methods are created once per runtime (see RNSVHostObject):
// `decodeCompositionFrames` is read at every vsync of the UI runtime.
jsi::Value VideoCompositionFramesExtractorHostObject::get(
    jsi::Runtime& runtime, const jsi::PropNameID& propNameId) {
  auto propName = propNameId.utf8(runtime);
  if (propName == "prepare") {
    return getFunction(
        runtime, propName, 0,
        [this](jsi::Runtime& runtime, const jsi::Value& thisValue,
               const jsi::Value* arguments, size_t count) -> jsi::Value {
          if (!released.test()) {
            prepare();
          }
          return jsi::Value::undefined();
        });
  } else if (propName == "play") {
    return getFunction(
        runtime, propName, 0,
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
    return getFunction(
        runtime, propName, 0,
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
    return getFunction(
        runtime, propName, 1,
        [this](jsi::Runtime& runtime, const jsi::Value& thisValue,
               const jsi::Value* arguments, size_t count) -> jsi::Value {
          if (!released.test()) {
            seekTo(
                CMTimeMakeWithSeconds(arguments[0].asNumber(), NSEC_PER_SEC));
          }
          return jsi::Value::undefined();
        });
  } else if (propName == "decodeCompositionFrames") {
    return getFunction(
        runtime, propName, 0,
        [this](jsi::Runtime& runtime, const jsi::Value& thisValue,
               const jsi::Value* arguments, size_t count) -> jsi::Value {
          @synchronized(lock) {
            if (released.test()) {
              return jsi::Object(runtime);
            }
            if (initialized) {
              auto currentTime = getCurrentTime();
              bool changed = false;
              for (const auto& entry : itemDecoders) {
                auto itemId = entry.first;
                auto decoder = entry.second;
                auto previousFrame = currentFrames[itemId];
                auto frame =
                    decoder->acquireFrameForTime(currentTime, !previousFrame);
                if (frame) {
                  currentFrames[itemId] = frame;
                  changed = true;
                }
              }
              if (changed) {
                framesVersion++;
              }
            }
            // The frames object is only rebuilt when a decoder produced a
            // new frame. On a 120 Hz display most calls see the same frames
            // as the previous one, and rewrapping them would be one JS
            // allocation per item per vsync.
            return getVersionedObject(
                runtime, "frames", (double)framesVersion,
                [&](jsi::Object& frames) {
                  for (const auto& entry : currentFrames) {
                    if (!entry.second) {
                      continue;
                    }
                    frames.setProperty(runtime, entry.first.c_str(),
                                       jsi::Object::createFromHostObject(
                                           runtime, entry.second));
                  }
                });
          }
        });
  } else if (propName == "on") {
    return getFunction(
        runtime, propName, 2,
        [this](jsi::Runtime& runtime, const jsi::Value& thisValue,
               const jsi::Value* arguments, size_t count) -> jsi::Value {
          @synchronized(lock) {
            if (released.test()) {
              // Nothing to listen to anymore: hand out a no-op unsubscribe.
              return jsi::Function::createFromHostFunction(
                  runtime, jsi::PropNameID::forAscii(runtime, "dispose"), 0,
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
    return getFunction(
        runtime, propName, 0,
        [this](jsi::Runtime& runtime, const jsi::Value& thisValue,
               const jsi::Value* arguments, size_t count) -> jsi::Value {
          this->release();
          return jsi::Value::undefined();
        });
  } else if (propName == "currentTime") {
    return jsi::Value(released.test() ? 0 : CMTimeGetSeconds(getCurrentTime()));
  } else if (propName == "framesVersion") {
    return jsi::Value(released.test() ? 0 : (double)framesVersion);
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
          std::vector<std::shared_ptr<VideoCompositionItemDecoder>> advancing;
          std::vector<std::shared_ptr<VideoCompositionItem>> opening;
          std::vector<std::shared_ptr<VideoCompositionItemDecoder>> closing;
          CMTime currentTime = kCMTimeZero;
          uint64_t generation = 0;
          @synchronized(lock) {
            if (released.test() || !initialized) {
              return;
            }
            currentTime = getCurrentTime();
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
            generation = seekGeneration;
            updateWindow(currentTime, opening, closing);
          }
          // Readers are slow to open and close: not while the UI thread waits
          // on the lock for its frames.
          for (const auto& decoder : closing) {
            decoder->release();
          }
          closing.clear();
          if (!opening.empty()) {
            openDecoders(opening, currentTime, generation);
          }
          @synchronized(lock) {
            if (released.test()) {
              return;
            }
            // Paused where every decoder has already been advanced to: there
            // is nothing to decode until the position moves or a seek lands.
            if (!isPlaying && opening.empty() &&
                generation == lastAdvancedGeneration &&
                CMTimeCompare(currentTime, lastAdvancedTime) == 0) {
              return;
            }
            lastAdvancedTime = currentTime;
            lastAdvancedGeneration = generation;
            for (const auto& entry : itemDecoders) {
              if (entry.second) {
                advancing.push_back(entry.second);
              }
            }
          }
          // In parallel on GCD's pool, instead of a new thread per decoder
          // per vsync.
          dispatch_apply(advancing.size(), DISPATCH_APPLY_AUTO, ^(size_t i) {
            advancing[i]->advanceDecoder(currentTime);
          });
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
      assetCache = [NSMutableDictionary dictionary];
      for (const auto& item : composition->items) {
        if (!item->isVideo || !opensAt(item, CMTimeGetSeconds(pausePosition))) {
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
      // A seek issued before init (a freshly created player positioned right
      // away by the JS side) only reached `pausePosition` and, above, the
      // audio player: the item decoders were still reading from zero and
      // caught up with the clock by decoding every frame in between —
      // visibly, a fast-forward from the start of the clip. Position them
      // where the audio starts.
      if (CMTimeCompare(pausePosition, kCMTimeZero) > 0) {
        for (const auto& entry : itemDecoders) {
          entry.second->seekTo(pausePosition);
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
    seekGeneration++;
    for (const auto& entry : itemDecoders) {
      entry.second->seekTo(time);
    }
  }
}

bool VideoCompositionFramesExtractorHostObject::opensAt(
    const std::shared_ptr<VideoCompositionItem>& item, double position) const {
  return window.opens(item->compositionStartTime,
                      item->compositionStartTime + item->duration, position,
                      composition->duration, false);
}

// Under the lock. Closed decoders leave the maps here and are released by the
// caller; opened ones are made by openDecoders.
void VideoCompositionFramesExtractorHostObject::updateWindow(
    CMTime time, std::vector<std::shared_ptr<VideoCompositionItem>>& opening,
    std::vector<std::shared_ptr<VideoCompositionItemDecoder>>& closing) {
  if (!window.isLazy()) {
    return;
  }
  double position = CMTimeGetSeconds(time);
  for (const auto& item : composition->items) {
    if (!item->isVideo) {
      continue;
    }
    double start = item->compositionStartTime;
    double end = start + item->duration;
    auto it = itemDecoders.find(item->id);
    if (it == itemDecoders.end()) {
      if (!failedItems.count(item->id) &&
          window.opens(start, end, position, composition->duration,
                       isLooping)) {
        NSLog(@"[rnskv] open %s at %.3fs", item->id.c_str(), position);
        opening.push_back(item);
      }
    } else if (!window.keeps(start, end, position, composition->duration,
                             isLooping)) {
      NSLog(@"[rnskv] close %s at %.3fs", item->id.c_str(), position);
      closing.push_back(it->second);
      itemDecoders.erase(it);
      if (currentFrames.erase(item->id) > 0) {
        framesVersion++;
      }
    }
  }
}

// On the decoder queue, outside of the lock.
void VideoCompositionFramesExtractorHostObject::openDecoders(
    const std::vector<std::shared_ptr<VideoCompositionItem>>& items,
    CMTime time, uint64_t generation) {
  for (const auto& item : items) {
    std::shared_ptr<VideoCompositionItemDecoder> decoder;
    NSError* failure = nil;
    try {
      decoder = std::make_shared<VideoCompositionItemDecoder>(
          item, true, getOrCreateAsset(item->path, assetCache), time);
    } catch (NSError* error) {
      failure = error;
    }
    if (failure) {
      // Decoder queue only, as updateWindow reads it.
      failedItems.insert(item->id);
      emit("error", [=](jsi::Runtime& runtime) -> jsi::Value {
        return RNSkiaVideo::NSErrorToJSI(runtime, failure);
      });
      continue;
    }
    @synchronized(lock) {
      if (released.test()) {
        decoder->release();
        return;
      }
      if (seekGeneration != generation) {
        decoder->seekTo(getCurrentTime());
      }
      itemDecoders[item->id] = decoder;
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
