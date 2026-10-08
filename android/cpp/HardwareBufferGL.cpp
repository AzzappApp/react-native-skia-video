#include "HardwareBufferGL.h"

#include <GLES2/gl2ext.h>
#include <android/hardware_buffer_jni.h>
#include <jni.h>
#include <poll.h>
#include <unistd.h>

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

void waitForSyncFence(int fd) {
  if (fd < 0) {
    return;
  }
  static const auto createSync = reinterpret_cast<PFNEGLCREATESYNCKHRPROC>(
      eglGetProcAddress("eglCreateSyncKHR"));
  static const auto waitSync = reinterpret_cast<PFNEGLWAITSYNCKHRPROC>(
      eglGetProcAddress("eglWaitSyncKHR"));
  static const auto destroySync = reinterpret_cast<PFNEGLDESTROYSYNCKHRPROC>(
      eglGetProcAddress("eglDestroySyncKHR"));
  EGLDisplay display = eglGetCurrentDisplay();
  if (createSync != nullptr && waitSync != nullptr && destroySync != nullptr &&
      display != EGL_NO_DISPLAY) {
    const EGLint attributes[] = {EGL_SYNC_NATIVE_FENCE_FD_ANDROID, fd,
                                 EGL_NONE};
    EGLSyncKHR sync =
        createSync(display, EGL_SYNC_NATIVE_FENCE_ANDROID, attributes);
    if (sync != EGL_NO_SYNC_KHR) {
      // EGL owns the fd now. The wait is queued on the GPU: the sync can be
      // destroyed right away.
      waitSync(display, sync, 0);
      destroySync(display, sync);
      return;
    }
  }
  struct pollfd pollFd = {fd, POLLIN, 0};
  poll(&pollFd, 1, 5000);
  close(fd);
}

int createSyncFence() {
  static const auto createSync = reinterpret_cast<PFNEGLCREATESYNCKHRPROC>(
      eglGetProcAddress("eglCreateSyncKHR"));
  static const auto destroySync = reinterpret_cast<PFNEGLDESTROYSYNCKHRPROC>(
      eglGetProcAddress("eglDestroySyncKHR"));
  static const auto dupNativeFence =
      reinterpret_cast<PFNEGLDUPNATIVEFENCEFDANDROIDPROC>(
          eglGetProcAddress("eglDupNativeFenceFDANDROID"));
  EGLDisplay display = eglGetCurrentDisplay();
  if (createSync != nullptr && destroySync != nullptr &&
      dupNativeFence != nullptr && display != EGL_NO_DISPLAY) {
    const EGLint attributes[] = {EGL_SYNC_NATIVE_FENCE_FD_ANDROID,
                                 EGL_NO_NATIVE_FENCE_FD_ANDROID, EGL_NONE};
    EGLSyncKHR sync =
        createSync(display, EGL_SYNC_NATIVE_FENCE_ANDROID, attributes);
    if (sync != EGL_NO_SYNC_KHR) {
      // The fence fd only exists once the commands are flushed.
      glFlush();
      int fd = dupNativeFence(display, sync);
      destroySync(display, sync);
      if (fd != EGL_NO_NATIVE_FENCE_FD_ANDROID) {
        return fd;
      }
    }
  }
  glFinish();
  return -1;
}

HardwareBufferFences& HardwareBufferFences::getInstance() {
  static HardwareBufferFences instance;
  return instance;
}

void HardwareBufferFences::setReadyFence(AHardwareBuffer* buffer, int fd) {
  std::lock_guard<std::mutex> lock(mutex);
  auto& entry = fences[buffer];
  if (entry.ready >= 0) {
    close(entry.ready);
  }
  entry.ready = fd;
}

int HardwareBufferFences::takeReadyFence(AHardwareBuffer* buffer) {
  std::lock_guard<std::mutex> lock(mutex);
  auto it = fences.find(buffer);
  if (it == fences.end()) {
    return -1;
  }
  int fd = it->second.ready;
  it->second.ready = -1;
  return fd;
}

int HardwareBufferFences::dupReadyFence(AHardwareBuffer* buffer) {
  std::lock_guard<std::mutex> lock(mutex);
  auto it = fences.find(buffer);
  if (it == fences.end() || it->second.ready < 0) {
    return -1;
  }
  return dup(it->second.ready);
}

void HardwareBufferFences::setReleaseFences(AHardwareBuffer* buffer,
                                            std::vector<int> fds) {
  std::vector<int> stale;
  {
    std::lock_guard<std::mutex> lock(mutex);
    auto it = fences.find(buffer);
    if (it == fences.end()) {
      stale = std::move(fds);
    } else {
      // The new fences are signaled after the previous ones (the reads were
      // submitted in order on the same queue).
      stale = std::move(it->second.release);
      it->second.release = std::move(fds);
    }
  }
  for (int fd : stale) {
    if (fd >= 0) {
      close(fd);
    }
  }
}

std::vector<int>
HardwareBufferFences::takeReleaseFences(AHardwareBuffer* buffer) {
  std::lock_guard<std::mutex> lock(mutex);
  auto it = fences.find(buffer);
  if (it == fences.end()) {
    return {};
  }
  return std::move(it->second.release);
}

void HardwareBufferFences::forget(AHardwareBuffer* buffer) {
  Fences entry;
  {
    std::lock_guard<std::mutex> lock(mutex);
    auto it = fences.find(buffer);
    if (it == fences.end()) {
      return;
    }
    entry = std::move(it->second);
    fences.erase(it);
  }
  if (entry.ready >= 0) {
    close(entry.ready);
  }
  for (int fd : entry.release) {
    if (fd >= 0) {
      close(fd);
    }
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

extern "C" JNIEXPORT void JNICALL
Java_com_azzapp_rnskv_HardwareBufferTexture_nativeWaitForRelease(
    JNIEnv* env, jclass clazz, jobject hardwareBuffer) {
  AHardwareBuffer* buffer =
      AHardwareBuffer_fromHardwareBuffer(env, hardwareBuffer);
  auto& registry = HardwareBufferFences::getInstance();
  // The frames handed out for the previous rendering hold their own
  // duplicates of its ready fence.
  int staleReadyFence = registry.takeReadyFence(buffer);
  if (staleReadyFence >= 0) {
    close(staleReadyFence);
  }
  for (int fd : registry.takeReleaseFences(buffer)) {
    waitForSyncFence(fd);
  }
}

extern "C" JNIEXPORT void JNICALL
Java_com_azzapp_rnskv_HardwareBufferTexture_nativeSignalReady(
    JNIEnv* env, jclass clazz, jobject hardwareBuffer) {
  AHardwareBuffer* buffer =
      AHardwareBuffer_fromHardwareBuffer(env, hardwareBuffer);
  HardwareBufferFences::getInstance().setReadyFence(buffer, createSyncFence());
}

extern "C" JNIEXPORT void JNICALL
Java_com_azzapp_rnskv_HardwareBufferTexture_nativeForget(
    JNIEnv* env, jclass clazz, jobject hardwareBuffer) {
  HardwareBufferFences::getInstance().forget(
      AHardwareBuffer_fromHardwareBuffer(env, hardwareBuffer));
}
