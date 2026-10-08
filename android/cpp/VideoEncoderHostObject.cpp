#include "VideoEncoderHostObject.h"
#include "EGLContextGuard.h"
#include "HardwareBufferGL.h"
#include "RNSVPixelData.h"
#include "VideoFrame.h"
#include <android/hardware_buffer_jni.h>

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

AHardwareBuffer* VideoEncoder::beginFrame() const {
  static const auto beginFrameMethod =
      getClass()->getMethod<JHardwareBuffer::javaobject()>("beginFrame");
  auto hardwareBuffer = beginFrameMethod(self());
  // The encoder keeps the buffer (and its reference on it) until released.
  return AHardwareBuffer_fromHardwareBuffer(Environment::current(),
                                            hardwareBuffer.get());
}

void VideoEncoder::endFrame(jdouble time) const {
  static const auto endFrameMethod =
      getClass()->getMethod<void(jdouble)>("endFrame");
  endFrameMethod(self(), time);
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
  result.push_back(jsi::PropNameID::forUtf8(rt, std::string("beginFrame")));
  result.push_back(jsi::PropNameID::forUtf8(rt, std::string("endFrame")));
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
  } else if (propName == "beginFrame") {
    return jsi::Function::createFromHostFunction(
        runtime, jsi::PropNameID::forAscii(runtime, "beginFrame"), 0,
        [this](jsi::Runtime& runtime, const jsi::Value& thisValue,
               const jsi::Value* arguments, size_t count) -> jsi::Value {
          if (released.test()) {
            throw jsi::JSError(runtime, "VideoEncoder.beginFrame(): the "
                                        "encoder was released");
          }
          EGLContextGuard contextGuard;
          framesExtractor->makeGLContextCurrent();
          auto buffer = framesExtractor->beginFrame();
          return jsi::BigInt::fromUint64(runtime,
                                         reinterpret_cast<uintptr_t>(buffer));
        });
  } else if (propName == "endFrame") {
    return jsi::Function::createFromHostFunction(
        runtime, jsi::PropNameID::forAscii(runtime, "endFrame"), 2,
        [this](jsi::Runtime& runtime, const jsi::Value& thisValue,
               const jsi::Value* arguments, size_t count) -> jsi::Value {
          if (count < 1 || !arguments[0].isNumber()) {
            throw jsi::JSError(runtime, "VideoEncoder.endFrame(..) expects a "
                                        "time (number)!");
          }
          // The sync fences (sync_file fds, owned by this call) signaled
          // when React Native Skia is done drawing into the buffer.
          std::vector<int> fences;
          if (count >= 2 && arguments[1].isObject()) {
            auto array = arguments[1].asObject(runtime).asArray(runtime);
            for (size_t i = 0; i < array.size(runtime); i++) {
              auto value = array.getValueAtIndex(runtime, i);
              if (value.isBigInt()) {
                fences.push_back(
                    static_cast<int>(value.asBigInt(runtime).asInt64(runtime)));
              }
            }
          }
          EGLContextGuard contextGuard;
          if (!released.test()) {
            framesExtractor->makeGLContextCurrent();
          }
          for (int fence : fences) {
            // Without a current context, waits on the CPU (and closes).
            waitForSyncFence(fence);
          }
          if (released.test()) {
            return jsi::Value::undefined();
          }
          framesExtractor->endFrame(arguments[0].asNumber());
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
    // The encoder releases its GL resources with its own context current.
    EGLContextGuard contextGuard;
    framesExtractor->release();
    framesExtractor = nullptr;
  }
}

} // namespace RNSkiaVideo
