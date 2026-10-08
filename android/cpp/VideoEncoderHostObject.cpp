#include "VideoEncoderHostObject.h"
#include <android/hardware_buffer_jni.h>
#include <cerrno>
#include <poll.h>
#include <unistd.h>

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

struct JHardwareBuffer : JavaClass<JHardwareBuffer> {
  static constexpr auto kJavaDescriptor = "Landroid/hardware/HardwareBuffer;";
};

AHardwareBuffer* VideoEncoder::getRenderTarget() const {
  static const auto getRenderTargetMethod =
      getClass()->getMethod<JHardwareBuffer()>("getRenderTarget");
  auto buffer = getRenderTargetMethod(self());
  if (!buffer) {
    return nullptr;
  }
  return AHardwareBuffer_fromHardwareBuffer(Environment::current(),
                                            buffer.get());
}

void VideoEncoder::encodeFrame(jdouble time) const {
  static const auto encodeFrameMethod =
      getClass()->getMethod<void(jdouble)>("encodeFrame");
  encodeFrameMethod(self(), time);
}

// Waits for a sync file descriptor (exported by Dawn at the end of its access
// to the render target) to be signaled, then closes it.
static void waitAndCloseSyncFd(int fd) {
  if (fd < 0) {
    return;
  }
  struct pollfd pfd = {.fd = fd, .events = POLLIN, .revents = 0};
  int result;
  do {
    result = poll(&pfd, 1, 5000);
  } while (result < 0 && (errno == EINTR || errno == EAGAIN));
  close(fd);
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
  result.push_back(jsi::PropNameID::forUtf8(rt, std::string("renderTarget")));
  result.push_back(jsi::PropNameID::forUtf8(rt, std::string("encodeFrame")));
  result.push_back(jsi::PropNameID::forUtf8(rt, std::string("finishWriting")));
  result.push_back(jsi::PropNameID::forUtf8(rt, std::string("dispose")));
  return result;
}

jsi::Value VideoEncoderHostObject::get(jsi::Runtime& runtime,
                                       const jsi::PropNameID& propNameId) {
  auto propName = propNameId.utf8(runtime);
  if (propName == "renderTarget") {
    if (released.test()) {
      return jsi::Value::null();
    }
    auto buffer = framesExtractor->getRenderTarget();
    if (!buffer) {
      return jsi::Value::null();
    }
    AHardwareBuffer_Desc desc = {};
    AHardwareBuffer_describe(buffer, &desc);
    auto target = jsi::Object(runtime);
    target.setProperty(
        runtime, "handle",
        jsi::BigInt::fromUint64(runtime, reinterpret_cast<uintptr_t>(buffer)));
    target.setProperty(runtime, "width", (int)desc.width);
    target.setProperty(runtime, "height", (int)desc.height);
    return target;
  } else if (propName == "encodeFrame") {
    return jsi::Function::createFromHostFunction(
        runtime, jsi::PropNameID::forAscii(runtime, "encodeFrame"), 2,
        [this](jsi::Runtime& runtime, const jsi::Value& thisValue,
               const jsi::Value* arguments, size_t count) -> jsi::Value {
          if (count < 1 || !arguments[0].isNumber()) {
            throw jsi::JSError(runtime, "encodeFrame expects a time");
          }
          // Optional sync fds signaled once the GPU is done rendering into
          // the render target (we take ownership of them).
          if (count >= 2 && arguments[1].isObject()) {
            auto fences = arguments[1].asObject(runtime).asArray(runtime);
            for (size_t i = 0; i < fences.size(runtime); i++) {
              auto fence = fences.getValueAtIndex(runtime, i);
              if (fence.isNumber()) {
                waitAndCloseSyncFd((int)fence.asNumber());
              }
            }
          }
          if (released.test()) {
            return jsi::Value::undefined();
          }
          framesExtractor->makeGLContextCurrent();
          try {
            framesExtractor->encodeFrame(arguments[0].asNumber());
          } catch (...) {
            releaseCurrentEGLContext();
            throw;
          }
          releaseCurrentEGLContext();
          return jsi::Value::undefined();
        });
  } else if (propName == "prepare") {
    return jsi::Function::createFromHostFunction(
        runtime, jsi::PropNameID::forAscii(runtime, "prepare"), 0,
        [this](jsi::Runtime& runtime, const jsi::Value& thisValue,
               const jsi::Value* arguments, size_t count) -> jsi::Value {
          if (!released.test()) {
            try {
              framesExtractor->prepare();
            } catch (...) {
              releaseCurrentEGLContext();
              throw;
            }
            releaseCurrentEGLContext();
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
