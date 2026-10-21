#pragma once

#include <EGL/egl.h>

namespace RNSkiaVideo {

/**
 * Saves the EGL context current on the calling thread and restores it when
 * going out of scope.
 *
 * The encoder renders with its own EGL context, on a thread it doesn't own
 * (the export's worklet runtime thread): the guard makes sure it doesn't leave
 * its context current there.
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
