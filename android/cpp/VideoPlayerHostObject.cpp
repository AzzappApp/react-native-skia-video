#include "VideoPlayerHostObject.h"
#include "JNIHelpers.h"

namespace RNSkiaVideo {
VideoPlayerHostObject::VideoPlayerHostObject(jsi::Runtime& runtime,
                                             const std::string& uri, int width,
                                             int height, double maxLongSide)
    : EventEmitter(runtime, JNIHelpers::getCallInvoker()) {
  jEventDispatcher = make_global(NativeEventDispatcher::create(this));
  player = make_global(
      VideoPlayer::create(uri, width, height, maxLongSide, jEventDispatcher));
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
  result.push_back(jsi::PropNameID::forUtf8(rt, std::string("playbackSpeed")));
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
          auto player = getPlayer();
          if (!player) {
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
          auto player = getPlayer();
          if (!player) {
            return jsi::Value::undefined();
          }
          auto time = arguments[0].asNumber();
          player->seekTo(time * 1000);
          return jsi::Value::undefined();
        });
  } else if (propName == "currentTime") {
    auto player = getPlayer();
    return jsi::Value(player ? (double)player->getCurrentPosition() / 1000.0
                             : 0);
  } else if (propName == "duration") {
    auto player = getPlayer();
    return jsi::Value(player ? (double)player->getDuration() / 1000.0 : 0);
  } else if (propName == "volume") {
    auto player = getPlayer();
    return jsi::Value(player ? (double)player->getVolume() : 0);
  } else if (propName == "playbackSpeed") {
    auto player = getPlayer();
    return jsi::Value(player ? (double)player->getPlaybackSpeed() : 1);
  } else if (propName == "isLooping") {
    auto player = getPlayer();
    return jsi::Value(player && player->getIsLooping());
  } else if (propName == "isPlaying") {
    auto player = getPlayer();
    return jsi::Value(player && player->getIsPlaying());
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
  auto player = getPlayer();
  if (!player) {
    return;
  }
  if (propName == "volume") {
    player->setVolume(value.asNumber());
  } else if (propName == "playbackSpeed") {
    player->setPlaybackSpeed(value.asNumber());
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
    // A Java exception can have no message.
    auto message = data ? static_ref_cast<JString>(data)->toStdString()
                        : std::string("Unknown error");
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

// A copy: release() can reset the player on the JS thread while it is used on
// the UI thread. The Java player is safe to call once released.
jni::global_ref<VideoPlayer> VideoPlayerHostObject::getPlayer() {
  std::lock_guard<std::mutex> lock(playerMutex);
  return player;
}

void VideoPlayerHostObject::release() {
  if (!released.test_and_set()) {
    jEventDispatcher->invalidate();
    jni::global_ref<VideoPlayer> player;
    {
      std::lock_guard<std::mutex> lock(playerMutex);
      std::swap(player, this->player);
    }
    player->release();
    this->removeAllListeners();
    jEventDispatcher = nullptr;
  }
}
} // namespace RNSkiaVideo
