#pragma once
#include <EGL/egl.h>

namespace RNSkiaVideo {
class SkiaContextHolder {
public:
  SkiaContextHolder();

  void makeCurrent();

private:
  EGLContext context;
  EGLDisplay display;
  EGLSurface surfaceRead;
  EGLSurface surfaceDraw;
};
} // namespace RNSkiaVideo
