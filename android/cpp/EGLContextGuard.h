#pragma once

#include <EGL/egl.h>

namespace RNSkiaVideo {

/**
 * Saves the EGL context current on the calling thread and restores it when
 * going out of scope.
 *
 * The decoders and the encoder render with their own EGL contexts, on threads
 * they don't own (the UI thread, worklet runtimes threads): the guard makes
 * sure they don't leave their context current there.
 */
class EGLContextGuard {
public:
  EGLContextGuard()
      : display(eglGetCurrentDisplay()),
        drawSurface(eglGetCurrentSurface(EGL_DRAW)),
        readSurface(eglGetCurrentSurface(EGL_READ)),
        context(eglGetCurrentContext()) {}

  ~EGLContextGuard() {
    if (context != EGL_NO_CONTEXT) {
      eglMakeCurrent(display, drawSurface, readSurface, context);
      return;
    }
    EGLDisplay currentDisplay = eglGetCurrentDisplay();
    if (currentDisplay != EGL_NO_DISPLAY) {
      eglMakeCurrent(currentDisplay, EGL_NO_SURFACE, EGL_NO_SURFACE,
                     EGL_NO_CONTEXT);
    }
  }

  EGLContextGuard(const EGLContextGuard&) = delete;
  EGLContextGuard& operator=(const EGLContextGuard&) = delete;

private:
  EGLDisplay display;
  EGLSurface drawSurface;
  EGLSurface readSurface;
  EGLContext context;
};

} // namespace RNSkiaVideo
