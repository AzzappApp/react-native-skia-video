#include "VideoPlayerHostObject.h"
#include "JNIHelpers.h"

namespace RNSkiaVideo {
using namespace RNSkia;

VideoPlayerHostObject::VideoPlayerHostObject(jsi::Runtime& runtime,
                                             const std::string& uri, int width,
                                             int height)
    : EventEmitter(runtime, JNIHelpers::getCallInvoker()) {
  jEventDispatcher = make_global(NativeEventDispatcher::create(this));
  player =
      make_global(VideoPlayer::create(uri, width, height, jEventDispatcher));
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
          if (released.test()) {
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
          if (!released.test()) {
            player->play();
          }
          return jsi::Value::undefined();
        });
  } else if (propName == "pause") {
    return jsi::Function::createFromHostFunction(
        runtime, jsi::PropNameID::forAscii(runtime, "pause"), 0,
        [this](jsi::Runtime& runtime, const jsi::Value& thisValue,
               const jsi::Value* arguments, size_t count) -> jsi::Value {
          if (!released.test()) {
            player->pause();
          }
          return jsi::Value::undefined();
        });
  } else if (propName == "seekTo") {
    return jsi::Function::createFromHostFunction(
        runtime, jsi::PropNameID::forAscii(runtime, "seekTo"), 1,
        [this](jsi::Runtime& runtime, const jsi::Value& thisValue,
               const jsi::Value* arguments, size_t count) -> jsi::Value {
          if (released.test()) {
            return jsi::Value::undefined();
          }
          auto time = arguments[0].asNumber();
          player->seekTo(time * 1000);
          return jsi::Value::undefined();
        });
  } else if (propName == "currentTime") {
    return jsi::Value(
        released.test() ? 0 : (double)player->getCurrentPosition() / 1000.0);
  } else if (propName == "duration") {
    return jsi::Value(released.test() ? 0
                                      : (double)player->getDuration() / 1000.0);
  } else if (propName == "volume") {
    return jsi::Value(released.test() ? 0 : (double)player->getVolume());
  } else if (propName == "isLooping") {
    return jsi::Value(!(released.test()) && player->getIsLooping());
  } else if (propName == "isPlaying") {
    return jsi::Value(!(released.test()) && player->getIsPlaying());
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
  }
  return jsi::Value::undefined();
}

void VideoPlayerHostObject::set(facebook::jsi::Runtime& runtime,
                                const facebook::jsi::PropNameID& propNameId,
                                const facebook::jsi::Value& value) {
  auto propName = propNameId.utf8(runtime);
  if (released.test()) {
    return;
  }
  if (propName == "volume") {
    player->setVolume(value.asNumber());
  } else if (propName == "isLooping") {
    player->setIsLooping(value.asBool());
  }
}

void VideoPlayerHostObject::handleEvent(std::string eventName,
                                        alias_ref<jobject> data) {
  if (eventName == "ready") {
    auto dimensions = static_ref_cast<JArrayInt>(data)->getRegion(0, 3);
    int width = dimensions[0];
    int height = dimensions[1];
    int rotation = dimensions[2];
    emit("ready", [=](jsi::Runtime& runtime) -> jsi::Value {
      auto dimensions = jsi::Object(runtime);
      dimensions.setProperty(runtime, "width", jsi::Value(width));
      dimensions.setProperty(runtime, "height", jsi::Value(height));
      dimensions.setProperty(runtime, "rotation", jsi::Value(rotation));
      return dimensions;
    });
  } else if (eventName == "error") {
    auto message = static_ref_cast<JString>(data)->toStdString();
    emit("error", [=](jsi::Runtime& runtime) -> jsi::Value {
      auto dimensions = jsi::Object(runtime);
      dimensions.setProperty(runtime, "message",
                             jsi::String::createFromUtf8(runtime, message));
      return dimensions;
    });
  } else if (eventName == "bufferingUpdate") {
    auto bufferedDuration = (double)static_ref_cast<JLong>(data)->value();
    emit("bufferingUpdate", [=](jsi::Runtime& runtime) -> jsi::Value {
      auto range = jsi::Object(runtime);
      range.setProperty(runtime, "start", jsi::Value(0));
      range.setProperty(runtime, "duration",
                        jsi::Value(bufferedDuration / 1000));
      auto ranges = jsi::Array(runtime, 1);
      ranges.setValueAtIndex(runtime, 0, range);
      return ranges;
    });
  } else if (eventName == "playingStatusChange") {
    bool playing = static_ref_cast<JBoolean>(data)->value();
    __android_log_print(ANDROID_LOG_INFO, "VideoPlayer",
                        "playingStatusChange %d", playing);
    emit("playingStatusChange",
         [=](jsi::Runtime&) { return jsi::Value(playing); });
  } else {
    emit(eventName);
  }
}

void VideoPlayerHostObject::release() {
  if (!released.test_and_set()) {
    player->release();
    player = nullptr;
    this->removeAllListeners();
    jEventDispatcher = nullptr;
  }
}
} // namespace RNSkiaVideo
