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
  jsiTextureInfo.setProperty(runtime, "glTarget", (int)GL_TEXTURE_2D);
  jsiTextureInfo.setProperty(runtime, "glFormat", (int)GR_GL_RGBA8);
  jsiTextureInfo.setProperty(runtime, "glID", (int)texture);
  jsiTextureInfo.setProperty(runtime, "glProtected", 0);

  jsObject.setProperty(runtime, "texture", jsiTextureInfo);

  return jsObject;
}
} // namespace RNSkiaVideo
