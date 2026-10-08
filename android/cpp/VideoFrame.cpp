#include "VideoFrame.h"
#include "JNIHelpers.h"

namespace RNSkiaVideo {

struct JHardwareBuffer : JavaClass<JHardwareBuffer> {
  static constexpr auto kJavaDescriptor = "Landroid/hardware/HardwareBuffer;";
};

AHardwareBuffer* VideoFrame::getHardwareBuffer() {
  static const auto getBufferMethod =
      getClass()->getMethod<JHardwareBuffer()>("getBuffer");
  auto buffer = getBufferMethod(self());
  if (!buffer) {
    return nullptr;
  }
  // The AHardwareBuffer stays valid as long as the Java HardwareBuffer is
  // open: the frame extractor keeps it open until the next frames have been
  // decoded.
  return AHardwareBuffer_fromHardwareBuffer(Environment::current(),
                                            buffer.get());
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
  auto buffer = getHardwareBuffer();
  auto width = getWidth();
  auto height = getHeight();
  auto rotation = getRotation();
  auto jsObject = jsi::Object(runtime);

  jsObject.setProperty(runtime, "width", width);
  jsObject.setProperty(runtime, "height", height);
  jsObject.setProperty(runtime, "rotation", rotation);

  if (buffer) {
    jsObject.setProperty(
        runtime, "handle",
        jsi::BigInt::fromUint64(runtime, reinterpret_cast<uintptr_t>(buffer)));
  }

  return jsObject;
}
} // namespace RNSkiaVideo
