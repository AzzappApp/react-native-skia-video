package com.azzapp.rnskv;

import android.graphics.SurfaceTexture;
import android.opengl.GLES11Ext;
import android.opengl.GLES20;
import android.os.Handler;
import android.os.Looper;
import android.view.Surface;

import java.util.Objects;

import javax.microedition.khronos.egl.EGL10;

public class VideoOutputDownScaler implements SurfaceTexture.OnFrameAvailableListener {
  private final EGLResourcesHolder eglResourcesHolder;

  private final Surface inputSurface;

  private final TextureRenderer textureRenderer;

  private final SurfaceTexture surfaceTexture;

  private final int textureId;

  private final int outputWidth;

  private final int outputHeight;

  private boolean released = false;


  public VideoOutputDownScaler(Surface outputSurface, int outputWidth, int outputHeight) {
    this.outputWidth = outputWidth;
    this.outputHeight = outputHeight;
    eglResourcesHolder = EGLResourcesHolder.createWithWindowedSurface(EGL10.EGL_NO_CONTEXT, outputSurface);
    eglResourcesHolder.makeCurrent();
    int[] texIds = new int[2];
    GLES20.glGenTextures(2, texIds,0);

    textureId = texIds[0];

    GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, textureId);
    GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR);
    GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR);
    GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE);
    GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE);

    surfaceTexture = new SurfaceTexture(textureId);
    inputSurface = new Surface(surfaceTexture);
    textureRenderer = new TextureRenderer(true);

    surfaceTexture.setOnFrameAvailableListener(
      this, new Handler(Objects.requireNonNull(Looper.myLooper())));
  }

  public Surface getInputSurface() {
    return inputSurface;
  }

  @Override
  synchronized public void onFrameAvailable(SurfaceTexture surfaceTexture) {
    if(released) {
      return;
    }
    eglResourcesHolder.makeCurrent();
    surfaceTexture.updateTexImage();
    GLES20.glClearColor(0, 0, 0, 0);
    GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT);
    GLES20.glViewport(0, 0, outputWidth, outputHeight);
    textureRenderer.draw(textureId, EGLUtils.IDENTITY_MATRIX);
    eglResourcesHolder.setPresentationTime(surfaceTexture.getTimestamp());
    eglResourcesHolder.swapBuffers();
  }

  synchronized public void release() {
    if (!released) {
      released = true;
      inputSurface.release();
      surfaceTexture.release();
      textureRenderer.release();
      eglResourcesHolder.release();
    }
  }
}
