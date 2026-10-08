#pragma once
#include <EGL/egl.h>

namespace RNSkiaVideo {

/**
 * Unbinds the EGL context current on the calling thread, if any.
 *
 * The decoders and the encoder each own an EGL context that is made current
 * by their native methods. JS can call those methods from different threads
 * (the UI thread, worklet runtime threads...), and an EGL context can only be
 * current on one thread at a time: the host objects release it at the end of
 * every call.
 */
inline void releaseCurrentEGLContext() {
  if (eglGetCurrentContext() == EGL_NO_CONTEXT) {
    return;
  }
  eglMakeCurrent(eglGetDisplay(EGL_DEFAULT_DISPLAY), EGL_NO_SURFACE,
                 EGL_NO_SURFACE, EGL_NO_CONTEXT);
}

} // namespace RNSkiaVideo
