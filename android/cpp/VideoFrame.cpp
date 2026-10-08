#include "VideoFrame.h"
#include "HardwareBufferGL.h"
#include <android/hardware_buffer_jni.h>
#include <unistd.h>

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
      buffer, getId(), getWidth(), getHeight(), getRotation());
  return jsi::Object::createFromHostObject(runtime, hostObject);
}

VideoFrameHostObject::VideoFrameHostObject(AHardwareBuffer* buffer, int64_t id,
                                           int width, int height, int rotation)
    : buffer(buffer), id(id), width(width), height(height), rotation(rotation) {
  AHardwareBuffer_acquire(buffer);
  // A frame can be handed out several times (the composition decoders hand
  // out the last frame of an item until a new one is decoded): each one
  // carries the fence.
  readyFence = HardwareBufferFences::getInstance().dupReadyFence(buffer);
}

VideoFrameHostObject::~VideoFrameHostObject() {
  release({});
  AHardwareBuffer_release(buffer);
}

void VideoFrameHostObject::release(std::vector<int> releaseFences) {
  int fence;
  {
    std::lock_guard<std::mutex> lock(mutex);
    if (released) {
      for (int fd : releaseFences) {
        close(fd);
      }
      return;
    }
    released = true;
    fence = readyFence;
    readyFence = -1;
  }
  // React Native WebGPU imported a duplicate of the ready fence.
  if (fence >= 0) {
    close(fence);
  }
  if (!releaseFences.empty()) {
    HardwareBufferFences::getInstance().setReleaseFences(
        buffer, std::move(releaseFences));
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
  result.push_back(jsi::PropNameID::forUtf8(rt, std::string("readyFence")));
  result.push_back(jsi::PropNameID::forUtf8(rt, std::string("release")));
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
  } else if (propName == "id") {
    return jsi::Value(static_cast<double>(id));
  } else if (propName == "readyFence") {
    std::lock_guard<std::mutex> lock(mutex);
    if (readyFence >= 0) {
      return jsi::BigInt::fromInt64(runtime, readyFence);
    }
  } else if (propName == "release") {
    return jsi::Function::createFromHostFunction(
        runtime, jsi::PropNameID::forAscii(runtime, "release"), 1,
        [weakFrame = weak_from_this()](
            jsi::Runtime& runtime, const jsi::Value& thisValue,
            const jsi::Value* arguments, size_t count) -> jsi::Value {
          // The fences (sync_file fds, owned by this call) signaled once the
          // frame is read.
          std::vector<int> fences;
          if (count >= 1 && arguments[0].isObject()) {
            auto array = arguments[0].asObject(runtime).asArray(runtime);
            for (size_t i = 0; i < array.size(runtime); i++) {
              auto value = array.getValueAtIndex(runtime, i);
              if (value.isBigInt()) {
                fences.push_back(
                    static_cast<int>(value.asBigInt(runtime).asInt64(runtime)));
              }
            }
          }
          if (auto frame = weakFrame.lock()) {
            frame->release(std::move(fences));
          } else {
            for (int fd : fences) {
              close(fd);
            }
          }
          return jsi::Value::undefined();
        });
  }
  return jsi::Value::undefined();
}

} // namespace RNSkiaVideo
