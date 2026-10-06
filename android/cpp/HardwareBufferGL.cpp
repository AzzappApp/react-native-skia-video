#include "HardwareBufferGL.h"

#include <GLES2/gl2ext.h>
#include <android/hardware_buffer_jni.h>
#include <jni.h>

namespace RNSkiaVideo {

namespace {

  struct EGLImageFunctions {
    PFNEGLGETNATIVECLIENTBUFFERANDROIDPROC getNativeClientBuffer = nullptr;
    PFNEGLCREATEIMAGEKHRPROC createImage = nullptr;
    PFNEGLDESTROYIMAGEKHRPROC destroyImage = nullptr;
    PFNGLEGLIMAGETARGETTEXTURE2DOESPROC imageTargetTexture2D = nullptr;

    bool isValid() const {
      return getNativeClientBuffer != nullptr && createImage != nullptr &&
             destroyImage != nullptr && imageTargetTexture2D != nullptr;
    }
  };

  const EGLImageFunctions& getEGLImageFunctions() {
    static const EGLImageFunctions functions = [] {
      EGLImageFunctions result;
      result.getNativeClientBuffer =
          reinterpret_cast<PFNEGLGETNATIVECLIENTBUFFERANDROIDPROC>(
              eglGetProcAddress("eglGetNativeClientBufferANDROID"));
      result.createImage = reinterpret_cast<PFNEGLCREATEIMAGEKHRPROC>(
          eglGetProcAddress("eglCreateImageKHR"));
      result.destroyImage = reinterpret_cast<PFNEGLDESTROYIMAGEKHRPROC>(
          eglGetProcAddress("eglDestroyImageKHR"));
      result.imageTargetTexture2D =
          reinterpret_cast<PFNGLEGLIMAGETARGETTEXTURE2DOESPROC>(
              eglGetProcAddress("glEGLImageTargetTexture2DOES"));
      return result;
    }();
    return functions;
  }

  EGLDisplay getDisplay() {
    EGLDisplay display = eglGetCurrentDisplay();
    return display != EGL_NO_DISPLAY ? display
                                     : eglGetDisplay(EGL_DEFAULT_DISPLAY);
  }

} // namespace

EGLImageKHR bindHardwareBufferToTexture(AHardwareBuffer* buffer,
                                        GLuint texture) {
  const auto& functions = getEGLImageFunctions();
  if (buffer == nullptr || !functions.isValid()) {
    return EGL_NO_IMAGE_KHR;
  }
  EGLClientBuffer clientBuffer = functions.getNativeClientBuffer(buffer);
  if (clientBuffer == nullptr) {
    return EGL_NO_IMAGE_KHR;
  }
  const EGLint attributes[] = {EGL_IMAGE_PRESERVED_KHR, EGL_TRUE, EGL_NONE};
  EGLImageKHR image = functions.createImage(getDisplay(), EGL_NO_CONTEXT,
                                            EGL_NATIVE_BUFFER_ANDROID,
                                            clientBuffer, attributes);
  if (image == EGL_NO_IMAGE_KHR) {
    return EGL_NO_IMAGE_KHR;
  }
  // Drop the errors left behind by previous GL calls, so that only the ones
  // of the binding below are checked.
  for (int i = 0; i < 10 && glGetError() != GL_NO_ERROR; i++) {
  }
  glBindTexture(GL_TEXTURE_2D, texture);
  functions.imageTargetTexture2D(GL_TEXTURE_2D,
                                 static_cast<GLeglImageOES>(image));
  glBindTexture(GL_TEXTURE_2D, 0);
  if (glGetError() != GL_NO_ERROR) {
    functions.destroyImage(getDisplay(), image);
    return EGL_NO_IMAGE_KHR;
  }
  return image;
}

void destroyHardwareBufferImage(EGLImageKHR image) {
  const auto& functions = getEGLImageFunctions();
  if (image != EGL_NO_IMAGE_KHR && functions.destroyImage != nullptr) {
    functions.destroyImage(getDisplay(), image);
  }
}

} // namespace RNSkiaVideo

using namespace RNSkiaVideo;

extern "C" JNIEXPORT jlong JNICALL
Java_com_azzapp_rnskv_HardwareBufferTexture_nativeBindHardwareBuffer(
    JNIEnv* env, jclass clazz, jobject hardwareBuffer, jint texture) {
  AHardwareBuffer* buffer =
      AHardwareBuffer_fromHardwareBuffer(env, hardwareBuffer);
  return reinterpret_cast<jlong>(
      bindHardwareBufferToTexture(buffer, static_cast<GLuint>(texture)));
}

extern "C" JNIEXPORT void JNICALL
Java_com_azzapp_rnskv_HardwareBufferTexture_nativeDestroyImage(JNIEnv* env,
                                                               jclass clazz,
                                                               jlong image) {
  destroyHardwareBufferImage(reinterpret_cast<EGLImageKHR>(image));
}
