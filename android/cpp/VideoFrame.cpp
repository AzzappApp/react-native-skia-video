#include "VideoFrame.h"
#include "JNIHelpers.h"

namespace RNSkiaVideo {
AHardwareBuffer* VideoFrame::getHardwareBuffer() {
  static const auto getHardwareBufferMethod =
      getClass()->getMethod<jobject()>("getHardwareBuffer");
  auto hardwareBuffer = getHardwareBufferMethod(self());
  if (hardwareBuffer == nullptr) {
    return nullptr;
  }
  return AHardwareBuffer_fromHardwareBuffer(jni::Environment::current(),
                                            hardwareBuffer.get());
}

jint VideoFrame::getWidth() {
  static const auto getWidthMethod = getClass()->getMethod<jint()>("getWidth");
  return getWidthMethod(self());
}

jint VideoFrame::getHeight() {
  static const auto getHeightMethod =
      getClass()->getMethod<jint()>("getHeight");
  return getHeightMethod(self());
}

jint VideoFrame::getRotation() {
  static const auto getRotationMethod =
      getClass()->getMethod<jint()>("getRotation");
  return getRotationMethod(self());
}

jsi::Value VideoFrame::toJS(jsi::Runtime& runtime) {
  auto hardwareBuffer = getHardwareBuffer();
  if (hardwareBuffer == nullptr) {
    return jsi::Value::null();
  }
  auto width = getWidth();
  auto height = getHeight();
  auto rotation = getRotation();
  auto jsObject = jsi::Object(runtime);

  jsObject.setProperty(runtime, "width", width);
  jsObject.setProperty(runtime, "height", height);
  jsObject.setProperty(runtime, "rotation", rotation);
  jsObject.setProperty(
      runtime, "buffer",
      jsi::BigInt::fromUint64(
          runtime, reinterpret_cast<uintptr_t>(hardwareBuffer)));

  return jsObject;
}
} // namespace RNSkiaVideo
