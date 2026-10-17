#pragma once

#include <android/hardware_buffer.h>
#include <cstdint>
#include <fbjni/fbjni.h>
#include <jsi/jsi.h>
#include <memory>
#include <mutex>
#include <optional>
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
  jlong getId() const;
  jint getWidth() const;
  jint getHeight() const;
  jint getRotation() const;
  jboolean isYUV() const;
  jint getCropLeft() const;
  jint getCropTop() const;
  jint getCropWidth() const;
  jint getCropHeight() const;
  jint getSourceRotation() const;

  jsi::Value toJS(jsi::Runtime& jsRuntime) const;
};

/**
 * A frame in a buffer of its decoder, in the decoder's own YUV layout: the
 * region of the buffer holding the frame and the clockwise rotation to apply
 * to it (see DecodedFrame.yuv).
 */
struct YUVLayout {
  int x;
  int y;
  int width;
  int height;
  int rotation;
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
  VideoFrameHostObject(AHardwareBuffer* buffer, int64_t id, int width,
                       int height, int rotation,
                       std::optional<YUVLayout> yuv = std::nullopt);
  ~VideoFrameHostObject() override;

  /** Closes the ready fence (once read, imported or not needed). */
  void release(std::vector<int> releaseFences);

  /**
   * Waits on the CPU for the ready fence: for a device that cannot wait for
   * it on the GPU.
   */
  void waitForReady();

  std::vector<jsi::PropNameID> getPropertyNames(jsi::Runtime& rt) override;
  jsi::Value get(jsi::Runtime&, const jsi::PropNameID& name) override;

private:
  AHardwareBuffer* buffer;
  // See DecodedFrame.id: the same frame is handed out to JS again until a
  // new one is decoded, and JS copies it to the GPU once.
  int64_t id;
  std::mutex mutex;
  int readyFence = -1;
  bool released = false;
  int width;
  int height;
  int rotation;
  std::optional<YUVLayout> yuv;
};

} // namespace RNSkiaVideo
