#pragma once

#include <android/hardware_buffer.h>
#include <cstdint>
#include <fbjni/fbjni.h>
#include <jsi/jsi.h>
#include <memory>
#include <mutex>

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
 * released, until JS releases the frame (`release()`, once imported: React
 * Native WebGPU keeps a reference of its own) or collects it.
 */
class JSI_EXPORT VideoFrameHostObject
    : public jsi::HostObject,
      public std::enable_shared_from_this<VideoFrameHostObject> {
public:
  VideoFrameHostObject(AHardwareBuffer* buffer, int64_t id, int width,
                       int height, YUVLayout yuv);
  ~VideoFrameHostObject() override;

  /** Drops the reference on the buffer: `buffer` is undefined afterwards. */
  void release();

  std::vector<jsi::PropNameID> getPropertyNames(jsi::Runtime& rt) override;
  jsi::Value get(jsi::Runtime&, const jsi::PropNameID& name) override;

private:
  std::mutex mutex;
  AHardwareBuffer* buffer;
  // See DecodedFrame.id: the same frame is handed out to JS again until a
  // new one is decoded, and JS copies it to the GPU once.
  int64_t id;
  int width;
  int height;
  YUVLayout yuv;
};

} // namespace RNSkiaVideo
