#include "VideoEncoderHostObject.h"
#include <android/data_space.h>
#include <android/native_window_jni.h>
#include <dlfcn.h>

namespace RNSkiaVideo {
using namespace facebook::jni;

namespace {

  using SetBuffersTimestamp = int32_t (*)(ANativeWindow*, int64_t);

  // Sets the timestamp of the next buffer queued to the window: the encoder
  // takes it as the presentation time of the frame. This is what
  // eglPresentationTimeANDROID, and Android's Vulkan loader for
  // VK_GOOGLE_display_timing, do. Not in the NDK: an LL-NDK function of
  // libnativewindow (there since Android 9), looked up at runtime. Null if it
  // can't be.
  SetBuffersTimestamp getSetBuffersTimestamp() {
    static const SetBuffersTimestamp setBuffersTimestamp = [] {
      void* library = dlopen("libnativewindow.so", RTLD_NOW);
      return library == nullptr
                 ? nullptr
                 : reinterpret_cast<SetBuffersTimestamp>(
                       dlsym(library, "ANativeWindow_setBuffersTimestamp"));
    }();
    return setBuffersTimestamp;
  }

} // namespace

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

local_ref<JSurface> VideoEncoder::getInputSurface() const {
  static const auto getInputSurfaceMethod =
      getClass()->getMethod<JSurface::javaobject()>("getInputSurface");
  return getInputSurfaceMethod(self());
}

void VideoEncoder::endFrame() const {
  static const auto endFrameMethod = getClass()->getMethod<void()>("endFrame");
  endFrameMethod(self());
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
  encoder = make_global(VideoEncoder::create(
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
  result.push_back(jsi::PropNameID::forUtf8(rt, std::string("nativeWindow")));
  result.push_back(jsi::PropNameID::forUtf8(rt, std::string("beginFrame")));
  result.push_back(jsi::PropNameID::forUtf8(rt, std::string("endFrame")));
  result.push_back(jsi::PropNameID::forUtf8(rt, std::string("finishWriting")));
  result.push_back(jsi::PropNameID::forUtf8(rt, std::string("dispose")));
  return result;
}

jsi::Value VideoEncoderHostObject::get(jsi::Runtime& runtime,
                                       const jsi::PropNameID& propNameId) {
  auto propName = propNameId.utf8(runtime);
  if (propName == "nativeWindow") {
    if (released.test() || window == nullptr) {
      return jsi::Value::undefined();
    }
    return jsi::BigInt::fromUint64(runtime,
                                   reinterpret_cast<uintptr_t>(window));
  } else if (propName == "beginFrame") {
    return jsi::Function::createFromHostFunction(
        runtime, jsi::PropNameID::forAscii(runtime, "beginFrame"), 1,
        [this](jsi::Runtime& runtime, const jsi::Value& thisValue,
               const jsi::Value* arguments, size_t count) -> jsi::Value {
          if (count < 1 || !arguments[0].isNumber()) {
            throw jsi::JSError(runtime, "VideoEncoder.beginFrame(..) expects "
                                        "a time (number)!");
          }
          if (released.test() || window == nullptr) {
            throw jsi::JSError(runtime, "VideoEncoder.beginFrame(): the "
                                        "encoder is not prepared or was "
                                        "released");
          }
          auto setBuffersTimestamp = getSetBuffersTimestamp();
          if (setBuffersTimestamp == nullptr) {
            throw jsi::JSError(runtime,
                               "VideoEncoder.beginFrame(): can't set the "
                               "presentation time of the frames on this "
                               "device (no ANativeWindow_setBuffersTimestamp)");
          }
          auto timeNs =
              static_cast<int64_t>(arguments[0].asNumber() * 1'000'000'000.0);
          setBuffersTimestamp(window, timeNs);
          // The data space EGL gave the frames: the Vulkan swapchain sets
          // sRGB, with which encoders may convert the frames to YUV
          // differently. Here rather than once: set when the swapchain is
          // created, which happens again if it is recreated.
          ANativeWindow_setBuffersDataSpace(window, ADATASPACE_UNKNOWN);
          return jsi::Value::undefined();
        });
  } else if (propName == "endFrame") {
    return jsi::Function::createFromHostFunction(
        runtime, jsi::PropNameID::forAscii(runtime, "endFrame"), 1,
        [this](jsi::Runtime& runtime, const jsi::Value& thisValue,
               const jsi::Value* arguments, size_t count) -> jsi::Value {
          if (!released.test()) {
            encoder->endFrame();
          }
          return jsi::Value::undefined();
        });
  } else if (propName == "prepare") {
    return jsi::Function::createFromHostFunction(
        runtime, jsi::PropNameID::forAscii(runtime, "prepare"), 0,
        [this](jsi::Runtime& runtime, const jsi::Value& thisValue,
               const jsi::Value* arguments, size_t count) -> jsi::Value {
          if (!released.test() && window == nullptr) {
            encoder->prepare();
            auto surface = encoder->getInputSurface();
            // Holds a reference to the surface until released.
            window = ANativeWindow_fromSurface(Environment::current(),
                                               surface.get());
            if (window == nullptr) {
              throw jsi::JSError(runtime, "VideoEncoder.prepare(): could not "
                                          "get the encoder's input window");
            }
          }
          return jsi::Value::undefined();
        });
  } else if (propName == "finishWriting") {
    return jsi::Function::createFromHostFunction(
        runtime, jsi::PropNameID::forAscii(runtime, "finishWriting"), 0,
        [this](jsi::Runtime& runtime, const jsi::Value& thisValue,
               const jsi::Value* arguments, size_t count) -> jsi::Value {
          if (!released.test()) {
            encoder->finishWriting();
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
    encoder->release();
    encoder = nullptr;
    if (window != nullptr) {
      ANativeWindow_release(window);
      window = nullptr;
    }
  }
}

} // namespace RNSkiaVideo
