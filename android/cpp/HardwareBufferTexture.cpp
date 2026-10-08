#include <EGL/egl.h>
#include <EGL/eglext.h>
#include <GLES2/gl2.h>
#include <GLES2/gl2ext.h>
#include <android/hardware_buffer_jni.h>
#include <android/log.h>
#include <jni.h>

namespace {

PFNEGLGETNATIVECLIENTBUFFERANDROIDPROC getNativeClientBuffer() {
  static auto proc = reinterpret_cast<PFNEGLGETNATIVECLIENTBUFFERANDROIDPROC>(
      eglGetProcAddress("eglGetNativeClientBufferANDROID"));
  return proc;
}

PFNEGLCREATEIMAGEKHRPROC createImage() {
  static auto proc = reinterpret_cast<PFNEGLCREATEIMAGEKHRPROC>(
      eglGetProcAddress("eglCreateImageKHR"));
  return proc;
}

PFNEGLDESTROYIMAGEKHRPROC destroyImage() {
  static auto proc = reinterpret_cast<PFNEGLDESTROYIMAGEKHRPROC>(
      eglGetProcAddress("eglDestroyImageKHR"));
  return proc;
}

PFNGLEGLIMAGETARGETTEXTURE2DOESPROC imageTargetTexture2D() {
  static auto proc = reinterpret_cast<PFNGLEGLIMAGETARGETTEXTURE2DOESPROC>(
      eglGetProcAddress("glEGLImageTargetTexture2DOES"));
  return proc;
}

} // namespace

extern "C" JNIEXPORT jlong JNICALL
Java_com_azzapp_rnskv_HardwareBufferTexture_nativeBindHardwareBufferToTexture(
    JNIEnv* env, jclass, jobject hardwareBuffer, jint textureId) {
  if (!getNativeClientBuffer() || !createImage() || !imageTargetTexture2D()) {
    __android_log_print(ANDROID_LOG_ERROR, "RNSkiaVideo",
                        "EGL_ANDROID_image_native_buffer is not supported");
    return 0;
  }
  AHardwareBuffer* buffer =
      AHardwareBuffer_fromHardwareBuffer(env, hardwareBuffer);
  EGLClientBuffer clientBuffer = getNativeClientBuffer()(buffer);
  EGLDisplay display = eglGetDisplay(EGL_DEFAULT_DISPLAY);
  EGLint attributes[] = {EGL_IMAGE_PRESERVED_KHR, EGL_TRUE, EGL_NONE};
  EGLImageKHR image =
      createImage()(display, EGL_NO_CONTEXT, EGL_NATIVE_BUFFER_ANDROID,
                    clientBuffer, attributes);
  if (image == EGL_NO_IMAGE_KHR) {
    __android_log_print(ANDROID_LOG_ERROR, "RNSkiaVideo",
                        "eglCreateImageKHR failed: 0x%x", eglGetError());
    return 0;
  }
  glBindTexture(GL_TEXTURE_2D, (GLuint)textureId);
  imageTargetTexture2D()(GL_TEXTURE_2D, (GLeglImageOES)image);
  glBindTexture(GL_TEXTURE_2D, 0);
  return reinterpret_cast<jlong>(image);
}

extern "C" JNIEXPORT void JNICALL
Java_com_azzapp_rnskv_HardwareBufferTexture_nativeDestroyImage(JNIEnv*, jclass,
                                                               jlong image) {
  if (image != 0 && destroyImage()) {
    destroyImage()(eglGetDisplay(EGL_DEFAULT_DISPLAY),
                   reinterpret_cast<EGLImageKHR>(image));
  }
}
