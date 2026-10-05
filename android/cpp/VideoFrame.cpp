#include "VideoFrame.h"
#include <android/hardware_buffer_jni.h>

namespace RNSkiaVideo {

AHardwareBuffer* VideoFrame::getHardwareBuffer() const {
  static const auto getHardwareBufferMethod =
      getClass()->getMethod<jobject()>("getHardwareBuffer");
  auto hardwareBuffer = getHardwareBufferMethod(self());
  if (!hardwareBuffer) {
    return nullptr;
  }
  return AHardwareBuffer_fromHardwareBuffer(Environment::current(),
                                            hardwareBuffer.get());
}

jint VideoFrame::getWidth() const {
  static const auto getWidthMethod = getClass()->getMethod<jint()>("getWidth");
  return getWidthMethod(self());
}

jint VideoFrame::getHeight() const {
  static const auto getHeightMethod =
      getClass()->getMethod<jint()>("getHeight");
  return getHeightMethod(self());
}

jint VideoFrame::getRotation() const {
  static const auto getRotationMethod =
      getClass()->getMethod<jint()>("getRotation");
  return getRotationMethod(self());
}

jsi::Value VideoFrame::toJS(jsi::Runtime& runtime) const {
  auto buffer = getHardwareBuffer();
  if (buffer == nullptr) {
    return jsi::Value::null();
  }
  auto hostObject = std::make_shared<VideoFrameHostObject>(
      buffer, getWidth(), getHeight(), getRotation());
  return jsi::Object::createFromHostObject(runtime, hostObject);
}

VideoFrameHostObject::VideoFrameHostObject(AHardwareBuffer* buffer, int width,
                                           int height, int rotation)
    : buffer(buffer), width(width), height(height), rotation(rotation) {
  AHardwareBuffer_acquire(buffer);
}

VideoFrameHostObject::~VideoFrameHostObject() {
  AHardwareBuffer_release(buffer);
}

std::vector<jsi::PropNameID>
VideoFrameHostObject::getPropertyNames(jsi::Runtime& rt) {
  std::vector<jsi::PropNameID> result;
  result.push_back(jsi::PropNameID::forUtf8(rt, std::string("width")));
  result.push_back(jsi::PropNameID::forUtf8(rt, std::string("height")));
  result.push_back(jsi::PropNameID::forUtf8(rt, std::string("rotation")));
  result.push_back(jsi::PropNameID::forUtf8(rt, std::string("buffer")));
  return result;
}

jsi::Value VideoFrameHostObject::get(jsi::Runtime& runtime,
                                     const jsi::PropNameID& propNameId) {
  auto propName = propNameId.utf8(runtime);
  if (propName == "width") {
    return jsi::Value(width);
  } else if (propName == "height") {
    return jsi::Value(height);
  } else if (propName == "rotation") {
    return jsi::Value(rotation);
  } else if (propName == "buffer") {
    return jsi::BigInt::fromUint64(runtime,
                                   reinterpret_cast<uintptr_t>(buffer));
  }
  return jsi::Value::undefined();
}

} // namespace RNSkiaVideo
