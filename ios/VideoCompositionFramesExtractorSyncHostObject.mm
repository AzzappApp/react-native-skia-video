#include "VideoCompositionFramesExtractorSyncHostObject.h"

#import "AVAssetTrackUtils.h"
#import "JSIUtils.h"
#import <AVFoundation/AVFoundation.h>
#import <Foundation/Foundation.h>
#import <future>

namespace RNSkiaVideo {

VideoCompositionFramesExtractorSyncHostObject::
    VideoCompositionFramesExtractorSyncHostObject(jsi::Runtime& runtime,
                                                  jsi::Object jsComposition) {
  composition = VideoComposition::fromJS(runtime, jsComposition);
  try {
    for (const auto& item : composition->items) {
      itemDecoders[item->id] =
          std::make_shared<VideoCompositionItemDecoder>(item, false);
    }
  } catch (NSError* error) {
    itemDecoders.clear();
    throw error;
  }
}

VideoCompositionFramesExtractorSyncHostObject::
    ~VideoCompositionFramesExtractorSyncHostObject() {
  this->release();
}

std::vector<jsi::PropNameID>
VideoCompositionFramesExtractorSyncHostObject::getPropertyNames(
    jsi::Runtime& rt) {
  std::vector<jsi::PropNameID> result;
  result.push_back(jsi::PropNameID::forUtf8(rt, std::string("start")));
  result.push_back(
      jsi::PropNameID::forUtf8(rt, std::string("decodeCompositionFrames")));
  result.push_back(jsi::PropNameID::forUtf8(rt, std::string("dispose")));
  return result;
}

jsi::Value VideoCompositionFramesExtractorSyncHostObject::get(
    jsi::Runtime& runtime, const jsi::PropNameID& propNameId) {
  auto propName = propNameId.utf8(runtime);
  if (propName == "start") {
    return jsi::Function::createFromHostFunction(
        runtime, jsi::PropNameID::forAscii(runtime, "start"), 1,
        [this](jsi::Runtime& runtime, const jsi::Value& thisValue,
               const jsi::Value* arguments,
               size_t count) -> jsi::Value { return jsi::Value::undefined(); });
  } else if (propName == "decodeCompositionFrames") {
    return jsi::Function::createFromHostFunction(
        runtime, jsi::PropNameID::forAscii(runtime, "decodeCompositionFrames"),
        1,
        [this](jsi::Runtime& runtime, const jsi::Value& thisValue,
               const jsi::Value* arguments, size_t count) -> jsi::Value {
          auto currentTime =
              CMTimeMakeWithSeconds(arguments[0].asNumber(), NSEC_PER_SEC);
          auto frames = jsi::Object(runtime);
          for (const auto& entry : itemDecoders) {
            auto itemId = entry.first;
            auto decoder = entry.second;

            decoder->advanceDecoder(currentTime);

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
        });
  } else if (propName == "dispose") {
    return jsi::Function::createFromHostFunction(
        runtime, jsi::PropNameID::forAscii(runtime, "dispose"), 0,
        [this](jsi::Runtime& runtime, const jsi::Value& thisValue,
               const jsi::Value* arguments, size_t count) -> jsi::Value {
          this->release();
          return jsi::Value::undefined();
        });
  }
  return jsi::Value::undefined();
}

void VideoCompositionFramesExtractorSyncHostObject::release() {
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

} // namespace RNSkiaVideo
