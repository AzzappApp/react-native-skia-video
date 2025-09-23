package com.sheunglaili.rnskv;

import android.opengl.EGL14;
import android.opengl.EGLExt;
import android.view.Surface;

import javax.microedition.khronos.egl.EGL10;
import javax.microedition.khronos.egl.EGLConfig;
import javax.microedition.khronos.egl.EGLContext;
import javax.microedition.khronos.egl.EGLDisplay;
import javax.microedition.khronos.egl.EGLSurface;

/**
 * An object holding and allowing to interact with a set of EGL resources
 * (display, surface, context)
 */
public class EGLResourcesHolder {
  private final EGL10 egl;

  private final EGLDisplay eglDisplay;

  private final EGLContext eglContext;

  private final EGLSurface eglSurface;


  /**
   * Create a new EGLResourcesHolder holder with a Windowed surface
   *
   * @param sharedContext the context passed as share_context arguments to the eglCreateContext method
   * @param surface       the native android surface used to create the windowed surface
   * @return the created EGLResourcesHolder
   */
  public static EGLResourcesHolder createWithWindowedSurface(EGLContext sharedContext, Surface surface) {
    EGLUtils.purgeOpenGLError();
    EGL10 egl = (EGL10) EGLContext.getEGL();
    EGLDisplay eglDisplay = egl.eglGetDisplay(EGL10.EGL_DEFAULT_DISPLAY);

    EGLConfig[] configs = new EGLConfig[1];
    int[] numConfigs = new int[1];
    int[] configAttributes = new int[]{
      EGL10.EGL_RED_SIZE, 8,
      EGL10.EGL_GREEN_SIZE, 8,
      EGL10.EGL_BLUE_SIZE, 8,
      EGL10.EGL_ALPHA_SIZE, 8,
      EGL10.EGL_DEPTH_SIZE, 0,
      EGL10.EGL_STENCIL_SIZE, 0,
      EGL10.EGL_RENDERABLE_TYPE, EGL14.EGL_OPENGL_ES2_BIT,
      EGLUtils.EGL_RECORDABLE_ANDROID, 1,
      EGL10.EGL_NONE
    };
    boolean success =
      egl.eglChooseConfig(
        eglDisplay,
        configAttributes,
        configs,
        1,
        numConfigs
      );
    EGLUtils.checkGlError("eglChooseConfig");
    EGLConfig config = configs[0];


    if (!success) {
      throw new RuntimeException("No egl config found");
    }

    int[] glAttributes = new int[]{EGLUtils.EGL_CONTEXT_CLIENT_VERSION, 2, EGL10.EGL_NONE};
    EGLContext eglContext = egl.eglCreateContext(eglDisplay, config, sharedContext, glAttributes);
    EGLUtils.checkGlError("eglCreateContext");

    int[] surfaceAttributes = {
      EGL10.EGL_NONE
    };
    EGLSurface eglSurface = egl.eglCreateWindowSurface(eglDisplay, config, surface, surfaceAttributes);
    EGLUtils.checkGlError("eglCreateWindowSurface");

    return new EGLResourcesHolder(egl, eglContext, eglSurface, eglDisplay);
  }

  /**
   * Create a new EGLResourcesHolder holder with 1x1 PBBuffer surface
   * @param sharedContext the context passed as share_context arguments to the eglCreateContext method
   * @return the created EGLResourcesHolder
   */
  public static EGLResourcesHolder createWithPBBufferSurface(EGLContext sharedContext) {
    EGLUtils.purgeOpenGLError();
    EGL10 egl = (EGL10) EGLContext.getEGL();
    EGLDisplay eglDisplay = egl.eglGetDisplay(EGL10.EGL_DEFAULT_DISPLAY);

    EGLConfig[] configs = new EGLConfig[1];
    int[] numConfigs = new int[1];
    int[] configAttributes = new int[]{
      EGL10.EGL_RED_SIZE, 8,
      EGL10.EGL_GREEN_SIZE, 8,
      EGL10.EGL_BLUE_SIZE, 8,
      EGL10.EGL_ALPHA_SIZE, 8,
      EGL10.EGL_DEPTH_SIZE, 0,
      EGL10.EGL_STENCIL_SIZE, 0,
      EGL10.EGL_RENDERABLE_TYPE, EGL14.EGL_OPENGL_ES2_BIT,
      EGL14.EGL_CONFIG_CAVEAT, EGL14.EGL_NONE,
      EGL14.EGL_SURFACE_TYPE, EGL14.EGL_PBUFFER_BIT,
      EGL10.EGL_NONE
    };
    boolean success =
      egl.eglChooseConfig(
        eglDisplay,
        configAttributes,
        configs,
        1,
        numConfigs
      );
    EGLUtils.checkGlError("eglChooseConfig");

    if (!success) {
      throw new RuntimeException("No egl config found");
    }
    EGLConfig config = configs[0];

    int[] glAttributes = new int[]{EGLUtils.EGL_CONTEXT_CLIENT_VERSION, 2, EGL10.EGL_NONE};
    EGLContext eglContext = egl.eglCreateContext(eglDisplay, config, sharedContext, glAttributes);
    EGLUtils.checkGlError("eglCreateContext");

    int[] surfaceAttributes = {
      EGL10.EGL_WIDTH,
      1,
      EGL10.EGL_HEIGHT,
      1,
      EGL10.EGL_NONE
    };
    EGLSurface eglSurface = egl.eglCreatePbufferSurface(eglDisplay, config, surfaceAttributes);
    EGLUtils.checkGlError("eglCreatePbufferSurface");

    return new EGLResourcesHolder(egl, eglContext, eglSurface, eglDisplay);
  }

  private EGLResourcesHolder(EGL10 egl, EGLContext eglContext, EGLSurface eglSurface, EGLDisplay eglDisplay) {
    this.egl = egl;
    this.eglContext = eglContext;
    this.eglSurface = eglSurface;
    this.eglDisplay = eglDisplay;
  }

  /**
   * Make the opengl display, surface and context holded current
   *
   * @return true if the operation was successful
   */
  public boolean makeCurrent() {
    return egl.eglMakeCurrent(eglDisplay, eglSurface, eglSurface, eglContext);
  }

  /**
   * swap the buffer of the surface (use only with windowed surface)
   *
   * @return true if the operation was successful
   */
  public boolean swapBuffers() {
    EGLUtils.purgeOpenGLError();
    boolean result = egl.eglSwapBuffers(eglDisplay, eglSurface);
    EGLUtils.checkGlError("eglSwapBuffers");
    return result;
  }

  /**
   * Sends the presentation time stamp to EGL.
   * Time is expressed in nanoseconds.
   */
  public void setPresentationTime(long nsecs) {
    EGLUtils.purgeOpenGLError();

    android.opengl.EGLDisplay eglDisplay = EGL14.eglGetCurrentDisplay();
    android.opengl.EGLSurface eglSurface = EGL14.eglGetCurrentSurface(EGL14.EGL_DRAW);
    EGLExt.eglPresentationTimeANDROID(eglDisplay, eglSurface, nsecs);

    EGLUtils.checkGlError("eglPresentationTimeANDROID");
  }

  /**
   * release the holed opengl resources
   */
  public void release() {
    if (eglSurface != EGL10.EGL_NO_SURFACE) {
      egl.eglDestroySurface(eglDisplay, eglSurface);
    }
    if (eglContext != EGL10.EGL_NO_CONTEXT) {
      egl.eglDestroyContext(eglDisplay, eglContext);
    }
  }
}
