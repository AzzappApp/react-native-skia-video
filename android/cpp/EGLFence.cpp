#include "EGLFence.h"

#include <GLES2/gl2.h>
#include <cstring>

namespace RNSkiaVideo {

namespace {

struct SyncProcs {
  PFNEGLCREATESYNCKHRPROC createSync = nullptr;
  PFNEGLDESTROYSYNCKHRPROC destroySync = nullptr;
  PFNEGLCLIENTWAITSYNCKHRPROC clientWaitSync = nullptr;
  PFNEGLWAITSYNCKHRPROC waitSync = nullptr;
  bool fences = false;
  bool serverWait = false;
};

const SyncProcs& syncProcs() {
  static const SyncProcs procs = [] {
    SyncProcs result;
    EGLDisplay display = eglGetDisplay(EGL_DEFAULT_DISPLAY);
    const char* extensions = display != EGL_NO_DISPLAY
                                 ? eglQueryString(display, EGL_EXTENSIONS)
                                 : nullptr;
    auto has = [extensions](const char* name) {
      return extensions != nullptr && std::strstr(extensions, name) != nullptr;
    };
    result.createSync = reinterpret_cast<PFNEGLCREATESYNCKHRPROC>(
        eglGetProcAddress("eglCreateSyncKHR"));
    result.destroySync = reinterpret_cast<PFNEGLDESTROYSYNCKHRPROC>(
        eglGetProcAddress("eglDestroySyncKHR"));
    result.clientWaitSync = reinterpret_cast<PFNEGLCLIENTWAITSYNCKHRPROC>(
        eglGetProcAddress("eglClientWaitSyncKHR"));
    result.waitSync = reinterpret_cast<PFNEGLWAITSYNCKHRPROC>(
        eglGetProcAddress("eglWaitSyncKHR"));
    result.fences = has("EGL_KHR_fence_sync") && result.createSync &&
                    result.destroySync && result.clientWaitSync;
    result.serverWait =
        result.fences && has("EGL_KHR_wait_sync") && result.waitSync;
    return result;
  }();
  return procs;
}

} // namespace

EGLFence EGLFence::insert() {
  EGLFence fence;
  const auto& procs = syncProcs();
  if (!procs.fences) {
    glFinish();
    return fence;
  }
  EGLDisplay display = eglGetCurrentDisplay();
  EGLSyncKHR sync = procs.createSync(display, EGL_SYNC_FENCE_KHR, nullptr);
  if (sync == EGL_NO_SYNC_KHR) {
    glFinish();
    return fence;
  }
  // The wait happens from another context, which never flushes this one:
  // make sure the fence command reaches the GPU.
  glFlush();
  fence.display = display;
  fence.sync = sync;
  return fence;
}

void EGLFence::waitInCurrentContext() {
  if (sync == EGL_NO_SYNC_KHR) {
    return;
  }
  const auto& procs = syncProcs();
  bool waited = procs.serverWait && procs.waitSync(display, sync, 0) == EGL_TRUE;
  if (!waited) {
    procs.clientWaitSync(display, sync, EGL_SYNC_FLUSH_COMMANDS_BIT_KHR,
                         EGL_FOREVER_KHR);
  }
  procs.destroySync(display, sync);
  sync = EGL_NO_SYNC_KHR;
}

EGLFence::~EGLFence() {
  if (sync != EGL_NO_SYNC_KHR) {
    syncProcs().destroySync(display, sync);
  }
}

EGLFence::EGLFence(EGLFence&& other) noexcept
    : display(other.display), sync(other.sync) {
  other.sync = EGL_NO_SYNC_KHR;
}

EGLFence& EGLFence::operator=(EGLFence&& other) noexcept {
  if (this != &other) {
    if (sync != EGL_NO_SYNC_KHR) {
      syncProcs().destroySync(display, sync);
    }
    display = other.display;
    sync = other.sync;
    other.sync = EGL_NO_SYNC_KHR;
  }
  return *this;
}

} // namespace RNSkiaVideo
