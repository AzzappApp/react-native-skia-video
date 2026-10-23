#pragma once

#include "VideoComposition.h"
#include <android/native_window.h>
#include <fbjni/fbjni.h>
#include <jsi/jsi.h>

namespace RNSkiaVideo {
using namespace facebook;
using namespace jni;

struct JSurface : public jni::JavaClass<JSurface> {
  static constexpr auto kJavaDescriptor = "Landroid/view/Surface;";
};

struct VideoEncoder : public jni::JavaClass<VideoEncoder> {

public:
  static constexpr auto kJavaDescriptor = "Lcom/azzapp/rnskv/VideoEncoder;";

  local_ref<VideoEncoder> static create(std::string& outPath, int width,
                                        int height, int frameRate, int bitRate,
                                        std::optional<std::string> encoderName,
                                        alias_ref<VideoComposition> composition,
                                        int audioSampleRate,
                                        int audioChannelCount,
                                        int audioBitRate);

  void prepare() const;

  local_ref<JSurface> getInputSurface() const;

  void endFrame() const;

  void finishWriting() const;

  void release() const;
};

/**
 * The encoder of an export. React Native Skia renders each frame straight
 * into the encoder's input surface (`nativeWindow`), through a WebGPU canvas
 * context (React Native WebGPU's MakeWebGPUCanvasContextFromNativeWindow):
 * `beginFrame(time)` stamps the next frame presented to it with its
 * presentation time, `endFrame()` writes what the encoder encoded.
 */
class JSI_EXPORT VideoEncoderHostObject : public jsi::HostObject {
public:
  VideoEncoderHostObject(std::string& outPath, int width, int height,
                         int frameRate, int bitRate,
                         std::optional<std::string> encoderName,
                         alias_ref<VideoComposition> composition,
                         int audioSampleRate, int audioChannelCount,
                         int audioBitRate);
  ~VideoEncoderHostObject() override;
  jsi::Value get(jsi::Runtime&, const jsi::PropNameID& name) override;
  std::vector<jsi::PropNameID> getPropertyNames(jsi::Runtime& rt) override;

private:
  global_ref<VideoEncoder> encoder;
  // The encoder's input surface, from prepare() until the encoder is
  // released.
  ANativeWindow* window = nullptr;
  std::atomic_flag released = ATOMIC_FLAG_INIT;
  void release();
};

} // namespace RNSkiaVideo
