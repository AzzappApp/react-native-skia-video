#pragma once

#include <EGL/egl.h>
#include <EGL/eglext.h>

namespace RNSkiaVideo {

/**
 * Orders GPU work across two EGL contexts.
 *
 * GL only orders commands within one context. On GPUs that run contexts
 * concurrently (Mali) a texture rendered from the decoder's or the encoder's
 * context can still be in flight when Skia's context samples or overwrites
 * it. `insert()` places a fence in the context bound to the calling thread,
 * right after the producing commands; `waitInCurrentContext()`, called once
 * the consuming context is bound, makes the commands issued afterwards wait
 * for the fence on the GPU, without stalling the CPU.
 *
 * Falls back to blocking waits when the EGL sync extensions are missing, so
 * the ordering guarantee holds everywhere.
 */
class EGLFence {
public:
  EGLFence() = default;
  ~EGLFence();
  EGLFence(EGLFence&& other) noexcept;
  EGLFence& operator=(EGLFence&& other) noexcept;
  EGLFence(const EGLFence&) = delete;
  EGLFence& operator=(const EGLFence&) = delete;

  /**
   * Call with the producing context current, after its GPU work was issued.
   * Without fence support this finishes the context instead and returns an
   * empty fence.
   */
  static EGLFence insert();

  /**
   * Call with the consuming context current. Server side wait when
   * EGL_KHR_wait_sync is available, client side wait otherwise. Destroys the
   * fence.
   */
  void waitInCurrentContext();

private:
  EGLDisplay display = EGL_NO_DISPLAY;
  EGLSyncKHR sync = EGL_NO_SYNC_KHR;
};

} // namespace RNSkiaVideo
