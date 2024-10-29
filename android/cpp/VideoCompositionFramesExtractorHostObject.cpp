#include "VideoCompositionFramesExtractorHostObject.h"
#include "JNIHelpers.h"

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
  if (propName == "decodeCompositionFrames") {
    return jsi::Function::createFromHostFunction(
        runtime, jsi::PropNameID::forAscii(runtime, "decodeCompositionFrames"),
        0,
        [this](jsi::Runtime& runtime, const jsi::Value& thisValue,
               const jsi::Value* arguments, size_t count) -> jsi::Value {
          auto result = jsi::Object(runtime);
          if (released.test()) {
            return result;
          }
          auto frames = player->decodeCompositionFrames();
          auto platformContext = JNIHelpers::getSkiaPlatformContext();
          for (auto& entry : *frames) {
            auto id = entry.first->toStdString();
            auto frame = entry.second;
            auto jsFrame = frame->toJS(runtime);
            result.setProperty(runtime, id.c_str(), std::move(jsFrame));
          }
          return result;
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
          if (!released.test()) {
            if (count != 1) {
              throw jsi::JSError(
                  runtime,
                  "VideoCompositionFramesExtractorHostObject."
                  "exportVideoComposition(..) expects 1 arguments (number)!");
            }
            auto posSec = arguments[0].asNumber();
            player->seekTo(posSec * 1000000);
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
    return jsi::Value(
        released.test() ? 0 : (double)player->getCurrentPosition() / 1000000.0);
  } else if (propName == "isLooping") {
    return jsi::Value(!released.test() && player->getIsLooping());
  } else if (propName == "isPlaying") {
    return jsi::Value(!released.test() && player->getIsPlaying());
  }
  return jsi::Value::undefined();
}

void VideoCompositionFramesExtractorHostObject::set(
    facebook::jsi::Runtime& runtime,
    const facebook::jsi::PropNameID& propNameId,
    const facebook::jsi::Value& value) {
  if (released.test()) {
    return;
  }
  auto propName = propNameId.utf8(runtime);
  if (propName == "isLooping") {
    player->setIsLooping(value.asBool());
  }
}

void VideoCompositionFramesExtractorHostObject::handleEvent(
    std::string eventName, alias_ref<jobject> data) {
  if (eventName == "error") {
    auto message = static_ref_cast<JString>(data)->toStdString();
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

void VideoCompositionFramesExtractorHostObject::release() {
  if (!released.test_and_set()) {
    removeAllListeners();
    player->release();
    player = nullptr;
    jEventDispatcher = nullptr;
  }
}
} // namespace RNSkiaVideo
