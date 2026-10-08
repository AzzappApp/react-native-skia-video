#pragma once

#include "VideoComposition.h"
#include <EGL/egl.h>
#include <android/hardware_buffer.h>
#include <fbjni/fbjni.h>
#include <jsi/jsi.h>

namespace RNSkiaVideo {
using namespace facebook;
using namespace jni;

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

  void makeGLContextCurrent() const;

  void encodePixels(uint8_t* pixels, size_t size, jdouble time) const;

  AHardwareBuffer* beginFrame() const;

  void endFrame(jdouble time) const;

  void finishWriting() const;

  void release() const;
};

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
  global_ref<VideoEncoder> framesExtractor;
  std::atomic_flag released = ATOMIC_FLAG_INIT;
  void release();
};

} // namespace RNSkiaVideo
