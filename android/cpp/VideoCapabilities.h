#pragma once

#include <fbjni/fbjni.h>
#include <jsi/jsi.h>

namespace RNSkiaVideo {
using namespace facebook;
using namespace jni;

struct DecoderInfo : JavaClass<DecoderInfo> {
public:
  static constexpr auto kJavaDescriptor =
      "Lcom/sheunglaili/rnskv/VideoCapabilities$DecoderInfo;";
  jint getMaxInstances() const;
  jint getMaxWidth() const;
  jint getMaxHeight() const;
};

struct EncoderInfo : JavaClass<EncoderInfo> {
public:
  static constexpr auto kJavaDescriptor =
      "Lcom/sheunglaili/rnskv/VideoCapabilities$EncoderInfo;";
  std::string getEncoderName() const;
  jboolean getHardwareAccelerated() const;
  jint getWidth() const;
  jint getHeight() const;
  jint getFrameRate() const;
  jint getBitrate() const;
};

struct VideoCapabilities : JavaClass<VideoCapabilities> {
public:
  static constexpr auto kJavaDescriptor =
      "Lcom/sheunglaili/rnskv/VideoCapabilities;";
  static jni::local_ref<DecoderInfo>
  getDecodingCapabilitiesFor(std::string mimeType);
  static jni::local_ref<JList<EncoderInfo>>
  getValidEncoderConfigurations(int width, int height, int framerate,
                                int bitrate);
};

} // namespace RNSkiaVideo
