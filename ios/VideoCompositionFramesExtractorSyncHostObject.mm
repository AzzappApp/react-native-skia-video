#include "VideoCompositionFramesExtractorSyncHostObject.h"

#import "AVAssetTrackUtils.h"
#import "RNSVJSIUtils.h"
#import <AVFoundation/AVFoundation.h>
#import <Foundation/Foundation.h>
#import <future>

namespace RNSkiaVideo {

VideoCompositionFramesExtractorSyncHostObject::
    VideoCompositionFramesExtractorSyncHostObject(
        std::shared_ptr<VideoComposition> composition)
    : composition(composition) {}

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
               const jsi::Value* arguments, size_t count) -> jsi::Value {
          return runPooled([&] {
            try {
              for (const auto& item : composition->items) {
                if (!item->isVideo) {
                  continue;
                }
                itemDecoders[item->id] =
                    std::make_shared<VideoCompositionItemDecoder>(item, false);
              }
            } catch (NSError* error) {
              itemDecoders.clear();
              throw error;
            }
          });
        });
  } else if (propName == "decodeCompositionFrames") {
    return jsi::Function::createFromHostFunction(
        runtime, jsi::PropNameID::forAscii(runtime, "decodeCompositionFrames"),
        1,
        [this](jsi::Runtime& runtime, const jsi::Value& thisValue,
               const jsi::Value* arguments, size_t count) -> jsi::Value {
          auto currentTime =
              CMTimeMakeWithSeconds(arguments[0].asNumber(), NSEC_PER_SEC);
          auto frames = jsi::Object(runtime);
          std::string pendingError;
          @autoreleasepool {
            for (const auto& entry : itemDecoders) {
              auto itemId = entry.first;
              auto decoder = entry.second;

              // Only the live items' frames are handed out, and the items
              // are only decoded up to their end (see isDecodedAt): the
              // readers of the others are released.
              auto item = decoder->getItem();
              double seconds = CMTimeGetSeconds(currentTime);
              bool decoded =
                  item->isLiveAt(seconds) && item->isDecodedAt(seconds);
              if (!decoded) {
                decoder->release();
              }
              if (!item->isLiveAt(seconds)) {
                currentFrames.erase(itemId);
                continue;
              }
              if (decoded) {
                try {
                  decoder->advanceDecoder(currentTime);
                } catch (NSError* error) {
                  pendingError = describeNSError(error);
                  break;
                }
              }

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
          }
          if (!pendingError.empty()) {
            throw jsi::JSError(runtime, pendingError);
          }
          return frames;
        });
  } else if (propName == "dispose") {
    return jsi::Function::createFromHostFunction(
        runtime, jsi::PropNameID::forAscii(runtime, "dispose"), 0,
        [this](jsi::Runtime& runtime, const jsi::Value& thisValue,
               const jsi::Value* arguments, size_t count) -> jsi::Value {
          return runPooled([&] { this->release(); });
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
  } catch (...) {
  }
  itemDecoders.clear();
  currentFrames.clear();
}

} // namespace RNSkiaVideo
