#include "VideoEncoderHostObject.h"
#include "EGLContextGuard.h"
#include "RNSVPixelData.h"

namespace RNSkiaVideo {
using namespace facebook::jni;

local_ref<VideoEncoder>
VideoEncoder::create(std::string& outPath, int width, int height, int frameRate,
                     int bitRate, std::optional<std::string> encoderName,
                     alias_ref<VideoComposition> composition,
                     int audioSampleRate, int audioChannelCount,
                     int audioBitRate) {
  return newInstance(outPath, width, height, frameRate, bitRate,
                     encoderName.has_value() ? encoderName.value() : nullptr,
                     composition, audioSampleRate, audioChannelCount,
                     audioBitRate);
}

void VideoEncoder::prepare() const {
  static const auto prepareMethod = getClass()->getMethod<void()>("prepare");
  prepareMethod(self());
}

void VideoEncoder::makeGLContextCurrent() const {
  static const auto makeGLContextCurrentMethod =
      getClass()->getMethod<void()>("makeGLContextCurrent");
  makeGLContextCurrentMethod(self());
}

void VideoEncoder::encodePixels(uint8_t* pixels, size_t size,
                                jdouble time) const {
  static const auto encodePixelsMethod =
      getClass()->getMethod<void(alias_ref<JByteBuffer>, jdouble)>(
          "encodePixels");
  // A direct ByteBuffer on the JS array memory: no copy, valid during the
  // call only (the encoder uploads the pixels before returning).
  auto buffer = JByteBuffer::wrapBytes(pixels, size);
  encodePixelsMethod(self(), buffer, time);
}

void VideoEncoder::release() const {
  static const auto releaseMethod = getClass()->getMethod<void()>("release");
  releaseMethod(self());
}

void VideoEncoder::finishWriting() const {
  static const auto finishWritingMethod =
      getClass()->getMethod<void()>("finishWriting");
  finishWritingMethod(self());
}

VideoEncoderHostObject::VideoEncoderHostObject(
    std::string& outPath, int width, int height, int frameRate, int bitRate,
    std::optional<std::string> encoderName,
    alias_ref<VideoComposition> composition, int audioSampleRate,
    int audioChannelCount, int audioBitRate) {
  framesExtractor = make_global(VideoEncoder::create(
      outPath, width, height, frameRate, bitRate, encoderName, composition,
      audioSampleRate, audioChannelCount, audioBitRate));
}

VideoEncoderHostObject::~VideoEncoderHostObject() {
  this->release();
}

std::vector<jsi::PropNameID>
VideoEncoderHostObject::getPropertyNames(jsi::Runtime& rt) {
  std::vector<jsi::PropNameID> result;
  result.push_back(jsi::PropNameID::forUtf8(rt, std::string("prepare")));
  result.push_back(jsi::PropNameID::forUtf8(rt, std::string("encodeFrame")));
  result.push_back(jsi::PropNameID::forUtf8(rt, std::string("finishWriting")));
  result.push_back(jsi::PropNameID::forUtf8(rt, std::string("dispose")));
  return result;
}

jsi::Value VideoEncoderHostObject::get(jsi::Runtime& runtime,
                                       const jsi::PropNameID& propNameId) {
  auto propName = propNameId.utf8(runtime);
  if (propName == "encodeFrame") {
    return jsi::Function::createFromHostFunction(
        runtime, jsi::PropNameID::forAscii(runtime, "encodeFrame"), 2,
        [this](jsi::Runtime& runtime, const jsi::Value& thisValue,
               const jsi::Value* arguments, size_t count) -> jsi::Value {
          if (count < 2 || !arguments[1].isNumber()) {
            throw jsi::JSError(runtime,
                               "VideoEncoder.encodeFrame(..) expects pixels "
                               "(Uint8Array) and a time (number)!");
          }
          auto pixels = getPixelData(runtime, arguments[0],
                                     "VideoEncoder.encodeFrame(..)");
          if (released.test()) {
            return jsi::Value::undefined();
          }
          EGLContextGuard contextGuard;
          framesExtractor->makeGLContextCurrent();
          framesExtractor->encodePixels(const_cast<uint8_t*>(pixels.data),
                                        pixels.size, arguments[1].asNumber());
          return jsi::Value::undefined();
        });
  } else if (propName == "prepare") {
    return jsi::Function::createFromHostFunction(
        runtime, jsi::PropNameID::forAscii(runtime, "prepare"), 0,
        [this](jsi::Runtime& runtime, const jsi::Value& thisValue,
               const jsi::Value* arguments, size_t count) -> jsi::Value {
          if (!released.test()) {
            // The encoder renders the frames with its own EGL context.
            EGLContextGuard contextGuard;
            framesExtractor->prepare();
          }
          return jsi::Value::undefined();
        });
  } else if (propName == "finishWriting") {
    return jsi::Function::createFromHostFunction(
        runtime, jsi::PropNameID::forAscii(runtime, "finishWriting"), 0,
        [this](jsi::Runtime& runtime, const jsi::Value& thisValue,
               const jsi::Value* arguments, size_t count) -> jsi::Value {
          if (!released.test()) {
            framesExtractor->finishWriting();
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

void VideoEncoderHostObject::release() {
  if (!released.test_and_set()) {
    framesExtractor->release();
    framesExtractor = nullptr;
  }
}

} // namespace RNSkiaVideo
