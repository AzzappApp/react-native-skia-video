#pragma once

#include "VideoComposition.h"
#include <fbjni/fbjni.h>
#include <jsi/jsi.h>
#include <EGL/egl.h>

namespace RNSkiaVideo {
using namespace facebook;
using namespace jni;

struct VideoEncoder : public jni::JavaClass<VideoEncoder> {

public:
  static constexpr auto kJavaDescriptor = "Lcom/azzapp/rnskv/VideoEncoder;";

  local_ref<VideoEncoder> static create(std::string& outPath, int width,
                                        int height, int frameRate, int bitRate,
                                        std::optional<std::string> encoderName);

  void prepare() const;

  void makeGLContextCurrent() const;

  void encodeFrame(jint texture, jdouble time) const;

  void finishWriting() const;

  void release() const;
};

class JSI_EXPORT VideoCompositionEncoderHostObject : public jsi::HostObject {
public:
  VideoCompositionEncoderHostObject(std::string& outPath, int width, int height,
                                    int frameRate, int bitRate,
                                    std::optional<std::string> encoderName);
  ~VideoCompositionEncoderHostObject();
  jsi::Value get(jsi::Runtime&, const jsi::PropNameID& name) override;
  std::vector<jsi::PropNameID> getPropertyNames(jsi::Runtime& rt) override;

private:
  global_ref<VideoEncoder> framesExtractor;
  std::atomic_flag released = ATOMIC_FLAG_INIT;
  EGLContext skiaContext;
  EGLDisplay skiaDisplay;
  EGLSurface skiaSurfaceRead;
  EGLSurface skiaSurfaceDraw;
  void release();
};

} // namespace RNSkiaVideo
