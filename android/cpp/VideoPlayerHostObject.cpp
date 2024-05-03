#include "VideoPlayerHostObject.h"
#include "JSIJNIConversion.h"
#include "RNSkiaHelpers.h"

namespace RNSkiaVideo {
using namespace RNSkia;

VideoPlayerHostObject::VideoPlayerHostObject(jsi::Runtime& runtime,
                                             const std::string& uri)
    : EventEmitter(runtime, RNSkiaHelpers::getCallInvoker()) {
  eventBridge = new JEventBridge(&runtime, this);
  player =
      make_global(VideoPlayer::create(uri, eventBridge->getEventDispatcher()));
}

VideoPlayerHostObject::~VideoPlayerHostObject() {
  this->release();
}

std::vector<jsi::PropNameID>
VideoPlayerHostObject::getPropertyNames(jsi::Runtime& rt) {
  std::vector<jsi::PropNameID> result;
  result.push_back(
      jsi::PropNameID::forUtf8(rt, std::string("decodeNextFrame")));
  result.push_back(jsi::PropNameID::forUtf8(rt, std::string("play")));
  result.push_back(jsi::PropNameID::forUtf8(rt, std::string("pause")));
  result.push_back(jsi::PropNameID::forUtf8(rt, std::string("seekTo")));
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
          if (released) {
            return jsi::Value::null();
          }

          auto frame = player->decodeNextFrame();
          if (!frame) {
            return jsi::Value::null();
          }
          return frame->toJS(runtime);
        });
  } else if (propName == "play") {
    return jsi::Function::createFromHostFunction(
        runtime, jsi::PropNameID::forAscii(runtime, "play"), 0,
        [this](jsi::Runtime& runtime, const jsi::Value& thisValue,
               const jsi::Value* arguments, size_t count) -> jsi::Value {
          if (!released) {
            player->play();
          }
          return jsi::Value::undefined();
        });
  } else if (propName == "pause") {
    return jsi::Function::createFromHostFunction(
        runtime, jsi::PropNameID::forAscii(runtime, "pause"), 0,
        [this](jsi::Runtime& runtime, const jsi::Value& thisValue,
               const jsi::Value* arguments, size_t count) -> jsi::Value {
          if (!released) {
            player->pause();
          }
          return jsi::Value::undefined();
        });
  } else if (propName == "seekTo") {
    return jsi::Function::createFromHostFunction(
        runtime, jsi::PropNameID::forAscii(runtime, "seekTo"), 1,
        [this](jsi::Runtime& runtime, const jsi::Value& thisValue,
               const jsi::Value* arguments, size_t count) -> jsi::Value {
          if (released) {
            return jsi::Value::undefined();
          }
          auto time = arguments[0].asNumber();
          player->seekTo(time);
          return jsi::Value::undefined();
        });
  } else if (propName == "currentTime") {
    return jsi::Value(
        player == nullptr ? 0 : (double)player->getCurrentPosition() / 1000.0);
  } else if (propName == "duration") {
    return jsi::Value(player == nullptr ? 0 : (double)player->getDuration());
  } else if (propName == "volume") {
    return jsi::Value(player == nullptr ? 0 : (double)player->getVolume());
  } else if (propName == "isLooping") {
    return jsi::Value(!(player == nullptr) && player->getIsLooping());
  } else if (propName == "isPlaying") {
    return jsi::Value(!(player == nullptr) && player->getIsPlaying());
  } else if (propName == "on") {
    return jsi::Function::createFromHostFunction(
        runtime, jsi::PropNameID::forAscii(runtime, "on"), 2,
        [this](jsi::Runtime& runtime, const jsi::Value& thisValue,
               const jsi::Value* arguments, size_t count) -> jsi::Value {
          auto name = arguments[0].asString(runtime).utf8(runtime);
          auto handler = arguments[1].asObject(runtime).asFunction(runtime);
          return this->on(name, std::move(handler));
        });
  } else if (propName == "dispose") {
    return jsi::Function::createFromHostFunction(
        runtime, jsi::PropNameID::forAscii(runtime, "seekTo"), 0,
        [this](jsi::Runtime& runtime, const jsi::Value& thisValue,
               const jsi::Value* arguments, size_t count) -> jsi::Value {
          this->release();
          return jsi::Value::undefined();
        });
  }
  return jsi::Value::undefined();
}

void VideoPlayerHostObject::set(facebook::jsi::Runtime& runtime,
                                const facebook::jsi::PropNameID& propNameId,
                                const facebook::jsi::Value& value) {
  auto propName = propNameId.utf8(runtime);
  if (released) {
    return;
  }
  if (propName == "volume") {
    player->setVolume(value.asNumber());
  } else if (propName == "isLooping") {
    player->setIsLooping(value.asBool());
  }
}

void VideoPlayerHostObject::release() {
  if (!released) {
    player->release();
    this->removeAllListeners();
    released = true;
    eventBridge = nullptr;
  }
}
} // namespace RNSkiaVideo
