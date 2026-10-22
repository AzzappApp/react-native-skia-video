#include "HardwareBufferGL.h"

#include <GLES2/gl2ext.h>
#include <android/hardware_buffer_jni.h>
#include <cerrno>
#include <poll.h>
#include <string_view>
#include <sys/system_properties.h>
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

namespace {

  // How long the CPU waits for a frame to be drawn, when the GPU can't: a
  // frame that isn't drawn by then fails the export rather than being encoded
  // unfinished.
  constexpr int kCPUWaitTimeoutMs = 1000;

  bool hasExtension(EGLDisplay display, std::string_view name) {
    const char* extensions = eglQueryString(display, EGL_EXTENSIONS);
    if (extensions == nullptr) {
      return false;
    }
    // A space-separated list: match whole names only.
    std::string_view list(extensions);
    for (size_t start = 0; start < list.size();) {
      size_t end = list.find(' ', start);
      if (end == std::string_view::npos) {
        end = list.size();
      }
      if (list.substr(start, end - start) == name) {
        return true;
      }
      start = end + 1;
    }
    return false;
  }

  // Testing: `adb shell setprop debug.rnskv.cpu_fence_wait 1`, then restart
  // the app, forces the wait on the CPU.
  bool isCPUWaitForced() {
    static const bool forced = [] {
      char value[PROP_VALUE_MAX] = {0};
      return __system_property_get("debug.rnskv.cpu_fence_wait", value) > 0 &&
             value[0] == '1';
    }();
    return forced;
  }

  // Has the current GL context wait for the fence on the GPU. False if it
  // can't, the fence then still to wait for. Doesn't take ownership of fd.
  bool waitOnGPU(int fd) {
    EGLDisplay display = eglGetCurrentDisplay();
    if (display == EGL_NO_DISPLAY || isCPUWaitForced() ||
        !hasExtension(display, "EGL_ANDROID_native_fence_sync") ||
        !hasExtension(display, "EGL_KHR_wait_sync")) {
      return false;
    }
    static const auto createSync = reinterpret_cast<PFNEGLCREATESYNCKHRPROC>(
        eglGetProcAddress("eglCreateSyncKHR"));
    static const auto waitSync = reinterpret_cast<PFNEGLWAITSYNCKHRPROC>(
        eglGetProcAddress("eglWaitSyncKHR"));
    static const auto destroySync = reinterpret_cast<PFNEGLDESTROYSYNCKHRPROC>(
        eglGetProcAddress("eglDestroySyncKHR"));
    if (createSync == nullptr || waitSync == nullptr ||
        destroySync == nullptr) {
      return false;
    }
    // eglCreateSyncKHR takes ownership of the fd it is given, even when it
    // fails: give it a duplicate, the original is kept for the CPU wait.
    int eglFd = dup(fd);
    if (eglFd < 0) {
      return false;
    }
    const EGLint attributes[] = {EGL_SYNC_NATIVE_FENCE_FD_ANDROID, eglFd,
                                 EGL_NONE};
    EGLSyncKHR sync =
        createSync(display, EGL_SYNC_NATIVE_FENCE_ANDROID, attributes);
    if (sync == EGL_NO_SYNC_KHR) {
      return false;
    }
    // The wait is queued on the GPU: the sync can be destroyed right away.
    EGLBoolean waiting = waitSync(display, sync, 0);
    destroySync(display, sync);
    return waiting == EGL_TRUE;
  }

  // Waits on the CPU until the fence signals, for kCPUWaitTimeoutMs at most.
  // Doesn't take ownership of fd.
  bool waitOnCPU(int fd) {
    struct pollfd pollFd = {fd, POLLIN, 0};
    int result;
    do {
      result = poll(&pollFd, 1, kCPUWaitTimeoutMs);
    } while (result < 0 && errno == EINTR);
    // A sync_file is readable once signaled; POLLERR if it signaled an error.
    return result > 0 && (pollFd.revents & POLLIN) != 0 &&
           (pollFd.revents & (POLLERR | POLLNVAL)) == 0;
  }

} // namespace

bool waitForSyncFence(int fd) {
  if (fd < 0) {
    return true;
  }
  bool waited = waitOnGPU(fd) || waitOnCPU(fd);
  close(fd);
  return waited;
}

} // namespace RNSkiaVideo

namespace RNSkiaVideo {

void JHardwareBufferTexture::registerNatives() {
  javaClassStatic()->registerNatives({
      makeNativeMethod("nativeBindHardwareBuffer",
                       JHardwareBufferTexture::nativeBindHardwareBuffer),
      makeNativeMethod("nativeDestroyImage",
                       JHardwareBufferTexture::nativeDestroyImage),
  });
}

jlong JHardwareBufferTexture::nativeBindHardwareBuffer(
    alias_ref<JClass>, alias_ref<JHardwareBuffer> hardwareBuffer,
    jint texture) {
  AHardwareBuffer* buffer = AHardwareBuffer_fromHardwareBuffer(
      Environment::current(), hardwareBuffer.get());
  return reinterpret_cast<jlong>(
      bindHardwareBufferToTexture(buffer, static_cast<GLuint>(texture)));
}

void JHardwareBufferTexture::nativeDestroyImage(alias_ref<JClass>,
                                                jlong image) {
  destroyHardwareBufferImage(reinterpret_cast<EGLImageKHR>(image));
}

} // namespace RNSkiaVideo
