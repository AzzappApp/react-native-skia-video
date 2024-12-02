#include "VideoCompositionEncoderHostObject.h"
#include <android/hardware_buffer_jni.h>
#include <EGL/egl.h>
#include <EGL/eglext.h>
#include <GLES/gl.h>
#include <GLES/glext.h>

namespace RNSkiaVideo {
using namespace facebook::jni;

local_ref<VideoEncoder>
VideoEncoder::create(std::string& outPath, int width, int height, int frameRate,
                     int bitRate, std::optional<std::string> encoderName) {
  return newInstance(outPath, width, height, frameRate, bitRate,
                     encoderName.has_value() ? encoderName.value() : nullptr);
}

void VideoEncoder::prepare() const {
  static const auto prepareMethod = getClass()->getMethod<void()>("prepare");
  prepareMethod(self());
}

void VideoEncoder::makeGLContextCurrent() const {
  static const auto makeGLContextCurrentMethod = getClass()->getMethod<void()>("makeGLContextCurrent");
  makeGLContextCurrentMethod(self());
}

void VideoEncoder::encodeFrame(jint texture, jdouble time) const {
  static const auto encodeFrameMethod =
      getClass()->getMethod<void(jint, jdouble)>("encodeFrame");
  encodeFrameMethod(self(), texture, time);
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

VideoCompositionEncoderHostObject::VideoCompositionEncoderHostObject(
    std::string& outPath, int width, int height, int frameRate, int bitRate,
    std::optional<std::string> encoderName) {
  framesExtractor = make_global(VideoEncoder::create(
      outPath, width, height, frameRate, bitRate, encoderName));
}

VideoCompositionEncoderHostObject::~VideoCompositionEncoderHostObject() {
  this->release();
}

std::vector<jsi::PropNameID>
VideoCompositionEncoderHostObject::getPropertyNames(jsi::Runtime& rt) {
  std::vector<jsi::PropNameID> result;
  result.push_back(jsi::PropNameID::forUtf8(rt, std::string("prepare")));
  result.push_back(
      jsi::PropNameID::forUtf8(rt, std::string("encodeFrame")));
  result.push_back(
      jsi::PropNameID::forUtf8(rt, std::string("finishWriting")));
  result.push_back(jsi::PropNameID::forUtf8(rt, std::string("dispose")));
  return result;
}

jsi::Value
VideoCompositionEncoderHostObject::get(jsi::Runtime& runtime,
                                       const jsi::PropNameID& propNameId) {
  auto propName = propNameId.utf8(runtime);
  if (propName == "encodeFrame") {
    return jsi::Function::createFromHostFunction(
        runtime, jsi::PropNameID::forAscii(runtime, "encodeFrame"), 2,
        [this](jsi::Runtime& runtime, const jsi::Value& thisValue,
               const jsi::Value* arguments, size_t count) -> jsi::Value {
          framesExtractor->makeGLContextCurrent();
          /*auto pointer = arguments[0].asBigInt(runtime).asUint64(runtime);
          const AHardwareBuffer *hardwareBuffer = reinterpret_cast<AHardwareBuffer *>(pointer);
          while (GL_NO_ERROR != glGetError()) {} //clear GL errors

          EGLClientBuffer clientBuffer = eglGetNativeClientBufferANDROID(hardwareBuffer);
          EGLint attribs[] = { EGL_IMAGE_PRESERVED_KHR, EGL_TRUE, EGL_NONE };
          EGLDisplay display = eglGetCurrentDisplay();
          // eglCreateImageKHR will add a ref to the AHardwareBuffer
          EGLImageKHR image = eglCreateImageKHR(display, EGL_NO_CONTEXT, EGL_NATIVE_BUFFER_ANDROID,
                                                clientBuffer, attribs);
          if (EGL_NO_IMAGE_KHR == image) {
            throw new std::runtime_error("Failed to acquire eglTexture");
          }

          GLuint texID;
          glGenTextures(1, &texID);
          glBindTexture(GL_TEXTURE_2D, texID);
          GLenum status = GL_NO_ERROR;
          if ((status = glGetError()) != GL_NO_ERROR) {
            throw new std::runtime_error("Failed to acquire eglTexture");
          }
          glEGLImageTargetTexture2DOES(GL_TEXTURE_2D, image);
          glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
          glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
          glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
          glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);

          eglDestroyImageKHR(display, image);
          if ((status = glGetError()) != GL_NO_ERROR) {
            throw new std::runtime_error("Failed to acquire eglTexture");
          }*/

          auto texId = arguments[0].asObject(runtime).getProperty(runtime, "fID").asNumber();

          framesExtractor->encodeFrame(
              (int)texId,
              arguments[1].asNumber());
          eglMakeCurrent(skiaDisplay, skiaSurfaceRead, skiaSurfaceDraw, skiaContext);
          return jsi::Value::undefined();
        });
  } else if (propName == "prepare") {
    return jsi::Function::createFromHostFunction(
        runtime, jsi::PropNameID::forAscii(runtime, "prepare"), 0,
        [this](jsi::Runtime& runtime, const jsi::Value& thisValue,
               const jsi::Value* arguments, size_t count) -> jsi::Value {
          if (!released.test()) {
            skiaDisplay = eglGetCurrentDisplay();
            skiaSurfaceRead = eglGetCurrentSurface(EGL_READ);
            skiaSurfaceDraw = eglGetCurrentSurface(EGL_DRAW);
            skiaContext = eglGetCurrentContext();

            framesExtractor->prepare();
            eglMakeCurrent(skiaDisplay, skiaSurfaceRead, skiaSurfaceDraw, skiaContext);
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

void VideoCompositionEncoderHostObject::release() {
  if (!released.test_and_set()) {
    framesExtractor->release();
    framesExtractor = nullptr;
  }
}

} // namespace RNSkiaVideo
