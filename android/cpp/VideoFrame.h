#pragma once

#include <android/hardware_buffer.h>
#include <fbjni/fbjni.h>
#include <jsi/jsi.h>

namespace RNSkiaVideo {

using namespace facebook;
using namespace jni;

struct VideoFrame : JavaClass<VideoFrame> {
public:
  static constexpr auto kJavaDescriptor = "Lcom/azzapp/rnskv/VideoFrame;";
  AHardwareBuffer* getHardwareBuffer();
  jint getWidth();
  jint getHeight();
  jint getRotation();

  jsi::Value toJS(jsi::Runtime& jsRuntime);
};

/**
 * The JS representation of a video frame.
 *
 * It holds a reference on the hardware buffer of the frame, so that the
 * pointer handed to JS stays valid even if the decoder that produced it is
 * released.
 */
class JSI_EXPORT VideoFrameHostObject : public jsi::HostObject {
public:
  VideoFrameHostObject(AHardwareBuffer* buffer, int width, int height,
                       int rotation);
  ~VideoFrameHostObject() override;

  std::vector<jsi::PropNameID> getPropertyNames(jsi::Runtime& rt) override;
  jsi::Value get(jsi::Runtime&, const jsi::PropNameID& name) override;

private:
  AHardwareBuffer* buffer;
  int width;
  int height;
  int rotation;
};

} // namespace RNSkiaVideo
