#pragma once

#include <android/hardware_buffer_jni.h>
#include <fbjni/fbjni.h>
#include <jsi/jsi.h>

namespace RNSkiaVideo {

using namespace facebook;
using namespace jni;

struct VideoFrame : JavaClass<VideoFrame> {
public:
  static constexpr auto kJavaDescriptor = "Lcom/azzapp/rnskv/VideoFrame;";
  AHardwareBuffer* getHardwareBuffer();
  jint getTexture();
  jint getWidth();
  jint getHeight();
  jint getRotation();

  jsi::Value toJS(jsi::Runtime& jsRuntime);
};
} // namespace RNSkiaVideo
