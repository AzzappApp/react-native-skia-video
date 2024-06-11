//
// Created by François de Campredon on 11/06/2024.
//

#include "VideoCapabilities.h"

namespace RNSkiaVideo {
jint DecoderInfo::getMaxInstances() const {
  static const auto getMaxInstancesMethod =
      getClass()->getMethod<jint()>("getMaxInstances");
  return getMaxInstancesMethod(self());
}

jint DecoderInfo::getMaxWidth() const {
  static const auto getMaxWidthMethod =
      getClass()->getMethod<jint()>("getMaxWidth");
  return getMaxWidthMethod(self());
}

jint DecoderInfo::getMaxHeight() const {
  static const auto getMaxHeightMethod =
      getClass()->getMethod<jint()>("getMaxHeight");
  return getMaxHeightMethod(self());
}

std::string EncoderInfo::getEncoderName() const {
  static const auto getEncoderNameMethod =
      getClass()->getMethod<jstring()>("getEncoderName");
  return getEncoderNameMethod(self())->toStdString();
}

jboolean EncoderInfo::getHardwareAccelerated() const {
  static const auto getHardwareAcceleratedMethod =
      getClass()->getMethod<jboolean()>("getHardwareAccelerated");
  return getHardwareAcceleratedMethod(self());
}

jint EncoderInfo::getWidth() const {
  static const auto getWidthMethod = getClass()->getMethod<jint()>("getWidth");
  return getWidthMethod(self());
}

jint EncoderInfo::getHeight() const {
  static const auto getHeightMethod =
      getClass()->getMethod<jint()>("getHeight");
  return getHeightMethod(self());
}

jint EncoderInfo::getFrameRate() const {
  static const auto getFrameRateMethod =
      getClass()->getMethod<jint()>("getFrameRate");
  return getFrameRateMethod(self());
}

jint EncoderInfo::getBitrate() const {
  static const auto getBitrateMethod =
      getClass()->getMethod<jint()>("getBitrate");
  return getBitrateMethod(self());
}

jni::local_ref<DecoderInfo>
VideoCapabilities::getDecodingCapabilitiesFor(std::string mimeType) {
  static const auto cls = javaClassStatic();
  static const auto getDecodingCapabilitiesForMethod =
      cls->getStaticMethod<jni::local_ref<DecoderInfo>(
          jni::alias_ref<JString>)>("getDecodingCapabilitiesFor");
  return getDecodingCapabilitiesForMethod(cls, jni::make_jstring(mimeType));
}

jni::local_ref<JList<EncoderInfo>>
VideoCapabilities::getValidEncoderConfigurations(int width, int height,
                                                 int framerate, int bitrate) {
  static const auto cls = javaClassStatic();

  static const auto getValidEncoderConfigurationsMethod =
      cls->getStaticMethod<jni::local_ref<JList<EncoderInfo>>(
          jint, jint, jint, jint)>("getValidEncoderConfigurations");
  return getValidEncoderConfigurationsMethod(cls, width, height, framerate,
                                             bitrate);
}

} // namespace RNSkiaVideo
