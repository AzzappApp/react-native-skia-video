#include "VideoCompositionFramesExtractorSyncHostObject.h"

namespace RNSkiaVideo {
using namespace facebook::jni;

local_ref<VideoCompositionFramesExtractorSync>
VideoCompositionFramesExtractorSync::create(
    alias_ref<VideoComposition> composition) {
  return newInstance(composition);
}

void VideoCompositionFramesExtractorSync::start() const {
  static const auto startMethod = getClass()->getMethod<void()>("start");
  startMethod(self());
}

local_ref<JMap<JString, VideoFrame>>
VideoCompositionFramesExtractorSync::decodeCompositionFrames(jdouble time) {
  static const auto decodeCompositionFramesMethod =
      getClass()->getMethod<JMap<JString, VideoFrame>(jdouble)>(
          "decodeCompositionFrames");
  return decodeCompositionFramesMethod(self(), time);
}

void VideoCompositionFramesExtractorSync::release() const {
  static const auto releaseMethod = getClass()->getMethod<void()>("release");
  releaseMethod(self());
}

VideoCompositionFramesExtractorSyncHostObject::
    VideoCompositionFramesExtractorSyncHostObject(jsi::Runtime& runtime,
                                                  jsi::Object jsComposition) {
  auto composition = VideoComposition::fromJSIObject(runtime, jsComposition);
  framesExtractor =
      make_global(VideoCompositionFramesExtractorSync::create(composition));
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
  if (propName == "decodeCompositionFrames") {
    return jsi::Function::createFromHostFunction(
        runtime, jsi::PropNameID::forAscii(runtime, "decodeCompositionFrames"),
        1,
        [this](jsi::Runtime& runtime, const jsi::Value& thisValue,
               const jsi::Value* arguments, size_t count) -> jsi::Value {
          auto result = jsi::Object(runtime);
          if (released.test()) {
            return result;
          }
          auto time = arguments[0].asNumber();
          auto frames = framesExtractor->decodeCompositionFrames(time);
          for (auto& entry : *frames) {
            auto id = entry.first->toStdString();
            auto frame = entry.second;
            auto jsFrame = frame->toJS(runtime);
            result.setProperty(runtime, id.c_str(), std::move(jsFrame));
          }
          return result;
        });
  } else if (propName == "start") {
    return jsi::Function::createFromHostFunction(
        runtime, jsi::PropNameID::forAscii(runtime, "start"), 0,
        [this](jsi::Runtime& runtime, const jsi::Value& thisValue,
               const jsi::Value* arguments, size_t count) -> jsi::Value {
          if (!released.test()) {
            framesExtractor->start();
          }
          return jsi::Value::undefined();
        });
  }
  if (propName == "dispose") {
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
  if (!released.test_and_set()) {
    framesExtractor->release();
    framesExtractor = nullptr;
  }
}

} // namespace RNSkiaVideo
