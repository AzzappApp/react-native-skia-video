#include "VideoCompositionFramesExtractorHostObject.h"
#include "JNIHelpers.h"

#include <algorithm>

namespace RNSkiaVideo {

VideoCompositionFramesExtractorHostObject::
    VideoCompositionFramesExtractorHostObject(jsi::Runtime& runtime,
                                              jsi::Object jsComposition)
    : EventEmitter(runtime, JNIHelpers::getCallInvoker()) {
  jEventDispatcher = make_global(NativeEventDispatcher::create(this));
  auto composition = VideoComposition::fromJSIObject(runtime, jsComposition);
  player = make_global(
      VideoCompositionFramesExtractor::create(composition, jEventDispatcher));
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
  result.push_back(jsi::PropNameID::forUtf8(rt, std::string("volume")));
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
          auto player = getPlayer();
          if (player && !prepared.test_and_set()) {
            player->prepare();
          }
          return jsi::Value::undefined();
        });
  } else if (propName == "decodeCompositionFrames") {
    return jsi::Function::createFromHostFunction(
        runtime, jsi::PropNameID::forAscii(runtime, "decodeCompositionFrames"),
        0,
        [this](jsi::Runtime& runtime, const jsi::Value& thisValue,
               const jsi::Value* arguments, size_t count) -> jsi::Value {
          auto result = jsi::Object(runtime);
          auto player = getPlayer();
          if (!player || !prepared.test()) {
            return result;
          }
          auto frames = player->decodeCompositionFrames();
          for (auto& entry : *frames) {
            auto id = entry.first->toStdString();
            auto jsFrame = entry.second->toJS(runtime);
            if (!jsFrame.isNull()) {
              result.setProperty(runtime, id.c_str(), std::move(jsFrame));
            }
          }
          return result;
        });
  } else if (propName == "play") {
    return jsi::Function::createFromHostFunction(
        runtime, jsi::PropNameID::forAscii(runtime, "play"), 0,
        [this](jsi::Runtime& runtime, const jsi::Value& thisValue,
               const jsi::Value* arguments, size_t count) -> jsi::Value {
          if (auto player = getPlayer()) {
            player->play();
          }
          return jsi::Value::undefined();
        });
  } else if (propName == "pause") {
    return jsi::Function::createFromHostFunction(
        runtime, jsi::PropNameID::forAscii(runtime, "pause"), 0,
        [this](jsi::Runtime& runtime, const jsi::Value& thisValue,
               const jsi::Value* arguments, size_t count) -> jsi::Value {
          if (auto player = getPlayer()) {
            player->pause();
          }
          return jsi::Value::undefined();
        });
  } else if (propName == "seekTo") {
    return jsi::Function::createFromHostFunction(
        runtime, jsi::PropNameID::forAscii(runtime, "seekTo"), 1,
        [this](jsi::Runtime& runtime, const jsi::Value& thisValue,
               const jsi::Value* arguments, size_t count) -> jsi::Value {
          if (auto player = getPlayer()) {
            if (count != 1) {
              throw jsi::JSError(
                  runtime,
                  "VideoCompositionFramesExtractorHostObject."
                  "exportVideoComposition(..) expects 1 arguments (number)!");
            }
            auto posSec = arguments[0].asNumber();
            player->seekTo((long)(posSec * 1000000));
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
                [](jsi::Runtime& runtime, const jsi::Value& thisValue,
                   const jsi::Value* arguments, size_t count) -> jsi::Value {
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
    auto player = getPlayer();
    return {player ? (double)player->getCurrentPosition() / 1000000.0 : 0};
  } else if (propName == "isLooping") {
    auto player = getPlayer();
    return {player && player->getIsLooping()};
  } else if (propName == "isPlaying") {
    auto player = getPlayer();
    return {player && player->getIsPlaying()};
  } else if (propName == "volume") {
    auto player = getPlayer();
    return {player ? (double)player->getVolume() : 0.0};
  }
  return jsi::Value::undefined();
}

void VideoCompositionFramesExtractorHostObject::set(
    facebook::jsi::Runtime& runtime,
    const facebook::jsi::PropNameID& propNameId,
    const facebook::jsi::Value& value) {
  auto player = getPlayer();
  if (!player) {
    return;
  }
  auto propName = propNameId.utf8(runtime);
  if (propName == "isLooping") {
    player->setIsLooping(value.asBool());
  } else if (propName == "volume") {
    player->setVolume((jfloat)std::max(0.0, std::min(1.0, value.asNumber())));
  }
}

void VideoCompositionFramesExtractorHostObject::handleEvent(
    std::string eventName, alias_ref<jobject> data) {
  if (eventName == "error") {
    // A Java exception can have no message (some of MediaCodec's).
    auto message = data ? static_ref_cast<JString>(data)->toStdString()
                        : std::string("Unknown error");
    emit("error", [=](jsi::Runtime& runtime) -> jsi::Value {
      auto dimensions = jsi::Object(runtime);
      dimensions.setProperty(runtime, "message",
                             jsi::String::createFromUtf8(runtime, message));
      return dimensions;
    });
  } else {
    emit(eventName);
  }
}

// A copy: release() can reset the player on the JS thread while it is used on
// the UI thread. The Java player is safe to call once released.
global_ref<VideoCompositionFramesExtractor>
VideoCompositionFramesExtractorHostObject::getPlayer() {
  std::lock_guard<std::mutex> lock(playerMutex);
  return player;
}

void VideoCompositionFramesExtractorHostObject::release() {
  if (!released.test_and_set()) {
    jEventDispatcher->invalidate();
    removeAllListeners();
    global_ref<VideoCompositionFramesExtractor> player;
    {
      std::lock_guard<std::mutex> lock(playerMutex);
      std::swap(player, this->player);
    }
    player->release();
    jEventDispatcher = nullptr;
  }
}
} // namespace RNSkiaVideo
