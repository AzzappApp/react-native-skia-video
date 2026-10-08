#pragma once

#include <android/hardware_buffer.h>
#include <fbjni/fbjni.h>
#include <jsi/jsi.h>
#include <memory>
#include <mutex>
#include <vector>

namespace RNSkiaVideo {

using namespace facebook;
using namespace jni;

struct JHardwareBuffer : JavaClass<JHardwareBuffer> {
  static constexpr auto kJavaDescriptor = "Landroid/hardware/HardwareBuffer;";
};

struct VideoFrame : JavaClass<VideoFrame> {
public:
  static constexpr auto kJavaDescriptor = "Lcom/azzapp/rnskv/VideoFrame;";
  AHardwareBuffer* getHardwareBuffer() const;
  jint getWidth() const;
  jint getHeight() const;
  jint getRotation() const;

  jsi::Value toJS(jsi::Runtime& jsRuntime) const;
};

/**
 * The JS representation of a video frame.
 *
 * It holds a reference on the hardware buffer of the frame, so that the
 * pointer handed to JS stays valid even if the decoder that produced it is
 * released, and the fence signaled when the decoder is done rendering the
 * frame (`readyFence`). JS reads the buffer after waiting for that fence and
 * hands back, with `release(fences)`, the fences signaled once it is done
 * reading it: the decoder waits for them before rendering into the buffer
 * again (see HardwareBufferFences).
 */
class JSI_EXPORT VideoFrameHostObject
    : public jsi::HostObject,
      public std::enable_shared_from_this<VideoFrameHostObject> {
public:
  VideoFrameHostObject(AHardwareBuffer* buffer, int width, int height,
                       int rotation);
  ~VideoFrameHostObject() override;

  /** Closes the ready fence (once read, imported or not needed). */
  void release(std::vector<int> releaseFences);

  std::vector<jsi::PropNameID> getPropertyNames(jsi::Runtime& rt) override;
  jsi::Value get(jsi::Runtime&, const jsi::PropNameID& name) override;

private:
  AHardwareBuffer* buffer;
  std::mutex mutex;
  int readyFence = -1;
  bool released = false;
  int width;
  int height;
  int rotation;
};

} // namespace RNSkiaVideo
