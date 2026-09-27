#include "VideoFrame.h"
#include "JNIHelpers.h"
#include <EGL/egl.h>
#include <GLES/gl.h>

namespace RNSkiaVideo {
#define GR_GL_RGBA8 0x8058
AHardwareBuffer* VideoFrame::getHardwareBuffer() {
  return nullptr;
}

jint VideoFrame::getTexture() {
  static const auto getTextureMethod =
      getClass()->getMethod<jint()>("getTexture");
  return getTextureMethod(self());
}

jint VideoFrame::getWidth() {
  static const auto getWidthMethod = getClass()->getMethod<jint()>("getWidth");
  return getWidthMethod(self());
}

jint VideoFrame::getHeight() {
  static const auto getHeightMethod =
      getClass()->getMethod<jint()>("getHeight");
  return getHeightMethod(self());
}

jint VideoFrame::getRotation() {
  static const auto getRotationMethod =
      getClass()->getMethod<jint()>("getRotation");
  return getRotationMethod(self());
}

jint VideoFrame::getTarget() {
  static const auto getTargetMethod =
      getClass()->getMethod<jint()>("getTarget");
  return getTargetMethod(self());
}

jint VideoFrame::getCropX() {
  static const auto method = getClass()->getMethod<jint()>("getCropX");
  return method(self());
}

jint VideoFrame::getCropY() {
  static const auto method = getClass()->getMethod<jint()>("getCropY");
  return method(self());
}

jint VideoFrame::getCropWidth() {
  static const auto method = getClass()->getMethod<jint()>("getCropWidth");
  return method(self());
}

jint VideoFrame::getCropHeight() {
  static const auto method = getClass()->getMethod<jint()>("getCropHeight");
  return method(self());
}

jsi::Value VideoFrame::toJS(jsi::Runtime& runtime) {
  auto texture = getTexture();
  auto width = getWidth();
  auto height = getHeight();
  auto rotation = getRotation();
  auto jsObject = jsi::Object(runtime);

  jsObject.setProperty(runtime, "width", width);
  jsObject.setProperty(runtime, "height", height);
  jsObject.setProperty(runtime, "rotation", rotation);

  jsi::Object jsiTextureInfo = jsi::Object(runtime);
  auto target = getTarget();
  jsiTextureInfo.setProperty(runtime, "glTarget", (int)target);
  jsiTextureInfo.setProperty(runtime, "glFormat", (int)GR_GL_RGBA8);
  jsiTextureInfo.setProperty(runtime, "glID", (int)texture);
  jsiTextureInfo.setProperty(runtime, "glProtected", 0);

  jsObject.setProperty(runtime, "texture", jsiTextureInfo);

  if (target != GL_TEXTURE_2D) {
    // The decoder's buffer (textureMode: 'direct'): the picture is its crop.
    auto crop = jsi::Object(runtime);
    crop.setProperty(runtime, "x", getCropX());
    crop.setProperty(runtime, "y", getCropY());
    crop.setProperty(runtime, "width", getCropWidth());
    crop.setProperty(runtime, "height", getCropHeight());
    jsObject.setProperty(runtime, "crop", crop);
  }

  return jsObject;
}
} // namespace RNSkiaVideo
