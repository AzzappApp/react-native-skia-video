#include "RNSkiaHelpers.h"
#include <SkiaOpenGLHelper.h>
#include <SkiaOpenGLSurfaceFactory.h>
#include <gpu/ganesh/gl/GrGLBackendSurface.h>

namespace RNSkiaVideo {

using namespace RNSkia;

std::shared_ptr<RNSkPlatformContext> RNSkiaHelpers::getSkiaPlatformContext() {
  auto clazz = javaClassStatic();
  static const auto getSkiaPlatformContextMethod =
      clazz->getStaticMethod<jobject()>("getSkiaPlatformContext");
  auto skiaManager = static_ref_cast<JniSkiaManager::javaobject>(
      getSkiaPlatformContextMethod(clazz));
  return skiaManager->cthis()->getPlatformContext();
}

std::shared_ptr<facebook::react::CallInvoker> RNSkiaHelpers::getCallInvoker() {
  auto clazz = javaClassStatic();
  static const auto getCallInvokerMethod =
      clazz->getStaticMethod<jobject()>("getCallInvoker");
  auto callInvoker =
      static_ref_cast<facebook::react::CallInvokerHolder::javaobject>(
          getCallInvokerMethod(clazz));
  return callInvoker->cthis()->getCallInvoker();
}

std::optional<std::pair<sk_sp<SkSurface>, EGLSurface>>
RNSkiaHelpers::createWindowSkSurface(ANativeWindow* window, int width,
                                     int height) {

  SkiaOpenGLContext* skiaOpenGlContext =
      &ThreadContextHolder::ThreadSkiaOpenGLContext;
  if (skiaOpenGlContext->directContext != nullptr) {
    throw new std::runtime_error(
        "createWindowSkSurface should only be called on export thread");
  }

  // Create OpenGL context attributes
  EGLint contextAttribs[] = {EGL_CONTEXT_CLIENT_VERSION, 2, EGL_NONE};

  // Initialize the offscreen context for this thread
  skiaOpenGlContext->glContext = eglCreateContext(
      OpenGLResourceHolder::getInstance().glDisplay,
      OpenGLResourceHolder::getInstance().glConfig,
      OpenGLResourceHolder::getInstance().glContext, contextAttribs);

  if (skiaOpenGlContext->glContext == EGL_NO_CONTEXT) {
    RNSkLogger::logToConsole("eglCreateContext failed: %d\n", eglGetError());
    return std::nullopt;
  }

  const EGLint offScreenSurfaceAttribs[] = {EGL_WIDTH, 1, EGL_HEIGHT, 1,
                                            EGL_NONE};

  skiaOpenGlContext->gl1x1Surface = eglCreatePbufferSurface(
      OpenGLResourceHolder::getInstance().glDisplay,
      OpenGLResourceHolder::getInstance().glConfig, offScreenSurfaceAttribs);

  if (skiaOpenGlContext->gl1x1Surface == EGL_NO_SURFACE) {
    RNSkLogger::logToConsole("Failed creating a 1x1 pbuffer surface");
    return std::nullopt;
  }

  if (!SkiaOpenGLHelper::makeCurrent(skiaOpenGlContext,
                                     skiaOpenGlContext->gl1x1Surface)) {
    return std::nullopt;
  }

  // Create the Skia context
  auto backendInterface = GrGLMakeNativeInterface();
  skiaOpenGlContext->directContext = GrDirectContexts::MakeGL(backendInterface);

  if (skiaOpenGlContext->directContext == nullptr) {
    RNSkLogger::logToConsole("GrDirectContexts::MakeGL failed");
    return std::nullopt;
  }

  // Now we can create a surface
  auto glSurface = SkiaOpenGLHelper::createWindowedSurface(window);
  if (glSurface == EGL_NO_SURFACE) {
    RNSkLogger::logToConsole(
        "Could not create EGL Surface from native window / surface.");
    return std::nullopt;
  }

  // Now make this one current
  if (!SkiaOpenGLHelper::makeCurrent(
          &ThreadContextHolder::ThreadSkiaOpenGLContext, glSurface)) {
    RNSkLogger::logToConsole(
        "Could not create EGL Surface from native window / surface. Could "
        "not set new surface as current surface.");
    return std::nullopt;
  }

  // Set up parameters for the render target so that it
  // matches the underlying OpenGL context.
  GrGLFramebufferInfo fboInfo;

  // We pass 0 as the framebuffer id, since the
  // underlying Skia GrGlGpu will read this when wrapping the context in the
  // render target and the GrGlGpu object.
  fboInfo.fFBOID = 0;
  fboInfo.fFormat = 0x8058; // GL_RGBA8

  GLint stencil;
  glGetIntegerv(GL_STENCIL_BITS, &stencil);

  GLint samples;
  glGetIntegerv(GL_SAMPLES, &samples);

  auto colorType = kN32_SkColorType;

  auto maxSamples = ThreadContextHolder::ThreadSkiaOpenGLContext.directContext
                        ->maxSurfaceSampleCountForColorType(colorType);

  if (samples > maxSamples) {
    samples = maxSamples;
  }

  auto renderTarget =
      GrBackendRenderTargets::MakeGL(width, height, samples, stencil, fboInfo);

  SkSurfaceProps props(0, kUnknown_SkPixelGeometry);

  struct ReleaseContext {
    EGLSurface glSurface;
  };

  auto releaseCtx = new ReleaseContext({glSurface});

  // Create surface object
  auto skSurface = SkSurfaces::WrapBackendRenderTarget(
      ThreadContextHolder::ThreadSkiaOpenGLContext.directContext.get(),
      renderTarget, kBottomLeft_GrSurfaceOrigin, colorType, nullptr, &props,
      [](void* addr) {
        auto releaseCtx = reinterpret_cast<ReleaseContext*>(addr);
        SkiaOpenGLHelper::destroySurface(releaseCtx->glSurface);
        delete releaseCtx;
      },
      reinterpret_cast<void*>(releaseCtx));

  return std::pair(skSurface, glSurface);
}

} // namespace RNSkiaVideo
