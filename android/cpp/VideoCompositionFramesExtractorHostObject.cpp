#include "VideoCompositionFramesExtractorHostObject.h"
#include "JSIJNIConversion.h"
#include "RNSkiaHelpers.h"

namespace RNSkiaVideo {

VideoCompositionFramesExtractorHostObject::
    VideoCompositionFramesExtractorHostObject(jsi::Runtime& runtime,
                                              jsi::Object jsComposition)
    : EventEmitter(runtime, RNSkiaHelpers::getCallInvoker()) {
  eventBridge = new JEventBridge(this);
  auto composition = VideoComposition::fromJSIObject(runtime, jsComposition);
  player = make_global(VideoCompositionFramesExtractor::create(
      composition, eventBridge->getEventDispatcher()));
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
          if (released) {
            return result;
          }
          auto frames = player->decodeCompositionFrames();
          auto platformContext = RNSkiaHelpers::getSkiaPlatformContext();
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
        runtime, jsi::PropNameID::forAscii(runtime, "pause"), 0,
        [this](jsi::Runtime& runtime, const jsi::Value& thisValue,
               const jsi::Value* arguments, size_t count) -> jsi::Value {
          if (!released) {
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
    return jsi::Value(released ? 0 : (double)player->getCurrentPosition());
  } else if (propName == "isLooping") {
    return jsi::Value(!released && player->getIsLooping());
  } else if (propName == "isPlaying") {
    return jsi::Value(!released && player->getIsPlaying());
  }
  return jsi::Value::undefined();
}

void VideoCompositionFramesExtractorHostObject::set(
    facebook::jsi::Runtime& runtime,
    const facebook::jsi::PropNameID& propNameId,
    const facebook::jsi::Value& value) {
  if (released) {
    return;
  }
  auto propName = propNameId.utf8(runtime);
  if (propName == "isLooping") {
    player->setIsLooping(value.asBool());
  }
}

void VideoCompositionFramesExtractorHostObject::release() {
  if (!released) {
    player->release();
    jsListeners.clear();
    released = true;
  }
}
} // namespace RNSkiaVideo
