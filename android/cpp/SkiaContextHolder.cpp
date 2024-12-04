#include "SkiaContextHolder.h"

namespace RNSkiaVideo {
SkiaContextHolder::SkiaContextHolder() {
  display = eglGetCurrentDisplay();
  surfaceRead = eglGetCurrentSurface(EGL_READ);
  surfaceDraw = eglGetCurrentSurface(EGL_DRAW);
  context = eglGetCurrentContext();
}

void SkiaContextHolder::makeCurrent() {
  eglMakeCurrent(display, surfaceDraw, surfaceRead, context);
}
} // namespace RNSkiaVideo
