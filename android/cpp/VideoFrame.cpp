#include "VideoFrame.h"
#include <android/hardware_buffer_jni.h>

namespace RNSkiaVideo {

AHardwareBuffer* VideoFrame::getHardwareBuffer() const {
  static const auto getHardwareBufferMethod =
      getClass()->getMethod<JHardwareBuffer::javaobject()>("getHardwareBuffer");
  auto hardwareBuffer = getHardwareBufferMethod(self());
  if (!hardwareBuffer) {
    return nullptr;
  }
  return AHardwareBuffer_fromHardwareBuffer(Environment::current(),
                                            hardwareBuffer.get());
}

jlong VideoFrame::getId() const {
  static const auto getIdMethod = getClass()->getMethod<jlong()>("getId");
  return getIdMethod(self());
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

jint VideoFrame::getCropLeft() const {
  static const auto getCropLeftMethod =
      getClass()->getMethod<jint()>("getCropLeft");
  return getCropLeftMethod(self());
}

jint VideoFrame::getCropTop() const {
  static const auto getCropTopMethod =
      getClass()->getMethod<jint()>("getCropTop");
  return getCropTopMethod(self());
}

jint VideoFrame::getCropWidth() const {
  static const auto getCropWidthMethod =
      getClass()->getMethod<jint()>("getCropWidth");
  return getCropWidthMethod(self());
}

jint VideoFrame::getCropHeight() const {
  static const auto getCropHeightMethod =
      getClass()->getMethod<jint()>("getCropHeight");
  return getCropHeightMethod(self());
}

jint VideoFrame::getSourceRotation() const {
  static const auto getSourceRotationMethod =
      getClass()->getMethod<jint()>("getSourceRotation");
  return getSourceRotationMethod(self());
}

jsi::Value VideoFrame::toJS(jsi::Runtime& runtime) const {
  auto buffer = getHardwareBuffer();
  if (buffer == nullptr) {
    return jsi::Value::null();
  }
  auto hostObject = std::make_shared<VideoFrameHostObject>(
      buffer, getId(), getWidth(), getHeight(),
      YUVLayout{getCropLeft(), getCropTop(), getCropWidth(), getCropHeight(),
                getSourceRotation()});
  return jsi::Object::createFromHostObject(runtime, hostObject);
}

VideoFrameHostObject::VideoFrameHostObject(AHardwareBuffer* buffer, int64_t id,
                                           int width, int height, YUVLayout yuv)
    : buffer(buffer), id(id), width(width), height(height), yuv(yuv) {
  AHardwareBuffer_acquire(buffer);
}

VideoFrameHostObject::~VideoFrameHostObject() {
  release();
}

void VideoFrameHostObject::release() {
  AHardwareBuffer* released;
  {
    std::lock_guard<std::mutex> lock(mutex);
    released = buffer;
    buffer = nullptr;
  }
  if (released != nullptr) {
    AHardwareBuffer_release(released);
  }
}

std::vector<jsi::PropNameID>
VideoFrameHostObject::getPropertyNames(jsi::Runtime& rt) {
  std::vector<jsi::PropNameID> result;
  result.push_back(jsi::PropNameID::forUtf8(rt, std::string("width")));
  result.push_back(jsi::PropNameID::forUtf8(rt, std::string("height")));
  result.push_back(jsi::PropNameID::forUtf8(rt, std::string("rotation")));
  result.push_back(jsi::PropNameID::forUtf8(rt, std::string("buffer")));
  result.push_back(jsi::PropNameID::forUtf8(rt, std::string("id")));
  result.push_back(jsi::PropNameID::forUtf8(rt, std::string("release")));
  result.push_back(jsi::PropNameID::forUtf8(rt, std::string("yuv")));
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
    // The frame is rotated with its conversion (see yuv).
    return jsi::Value(0);
  } else if (propName == "buffer") {
    std::lock_guard<std::mutex> lock(mutex);
    if (buffer != nullptr) {
      return jsi::BigInt::fromUint64(runtime,
                                     reinterpret_cast<uintptr_t>(buffer));
    }
  } else if (propName == "id") {
    return jsi::Value(static_cast<double>(id));
  } else if (propName == "yuv") {
    auto layout = jsi::Object(runtime);
    layout.setProperty(runtime, "x", yuv.x);
    layout.setProperty(runtime, "y", yuv.y);
    layout.setProperty(runtime, "width", yuv.width);
    layout.setProperty(runtime, "height", yuv.height);
    layout.setProperty(runtime, "rotation", yuv.rotation);
    return layout;
  } else if (propName == "release") {
    return jsi::Function::createFromHostFunction(
        runtime, jsi::PropNameID::forAscii(runtime, "release"), 0,
        [weakFrame = weak_from_this()](
            jsi::Runtime& runtime, const jsi::Value& thisValue,
            const jsi::Value* arguments, size_t count) -> jsi::Value {
          if (auto frame = weakFrame.lock()) {
            frame->release();
          }
          return jsi::Value::undefined();
        });
  }
  return jsi::Value::undefined();
}

} // namespace RNSkiaVideo
