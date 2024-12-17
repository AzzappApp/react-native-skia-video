package com.azzapp.rnskv;

import android.graphics.SurfaceTexture;
import android.opengl.GLES11Ext;
import android.opengl.GLES20;
import android.view.Surface;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * A class that extracts frames from a SurfaceTexture streaming to an external texture and renders
 * them to a 2D texture.
 */
public class GLFrameExtractor implements SurfaceTexture.OnFrameAvailableListener {

  private final AtomicBoolean frameAvailable = new AtomicBoolean(false);

  private final float[] transformMatrix = new float[16];

  private final Surface surface;

  private final SurfaceTexture surfaceTexture;

  private int frameWidth = -1;

  private int frameHeight = -1;

  private final int inputTexId;

  private final int outputTexId;

  private final int frameBuffer;

  private final TextureRenderer textureRenderer;

  private OnFrameAvailableListener onFrameAvailableListener;

  private long latestTimeStampNs = -1;

  public GLFrameExtractor() {
    EGLUtils.purgeOpenGLError();

    int[] texIds = new int[2];
    GLES20.glGenTextures(2, texIds,0);

    inputTexId = texIds[0];
    EGLUtils.configureTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, inputTexId);

    outputTexId = texIds[1];
    EGLUtils.configureTexture(GLES20.GL_TEXTURE_2D, outputTexId);

    int[] bufferIds = new int[1];
    GLES20.glGenFramebuffers(1, bufferIds, 0);
    frameBuffer = bufferIds[0];

    EGLUtils.checkGlError("GLFrameExtractor()");

    textureRenderer = new TextureRenderer(true);

    surfaceTexture = new SurfaceTexture(inputTexId);
    surfaceTexture.setOnFrameAvailableListener(this);
    surface = new Surface(surfaceTexture);
  }

  /**
   * Set the listener that will be called when a new frame is available.
   * @param onFrameAvailableListener the listener to set
   */
  public void setOnFrameAvailableListener(OnFrameAvailableListener onFrameAvailableListener) {
    this.onFrameAvailableListener = onFrameAvailableListener;
  }

  /**
   * Decode the next frame and render it to the output texture.
   * @param width the width of the frame
   * @param height the height of the frame
   * @return true if a new frame was decoded, false otherwise
   */
  public boolean decodeNextFrame(int width, int height) {
    if(!frameAvailable.compareAndSet(true, false)) {
      return false;
    }

    EGLUtils.purgeOpenGLError();

    if (width != frameWidth || height != frameHeight) {
      frameWidth = width;
      frameHeight = height;
      GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, outputTexId);
      GLES20.glTexImage2D(
        GLES20.GL_TEXTURE_2D,
        0,
        GLES20.GL_RGBA,
        width, height,
        0,
        GLES20.GL_RGBA,
        GLES20.GL_UNSIGNED_BYTE,
        null
      );
    }
    surfaceTexture.updateTexImage();
    latestTimeStampNs = surfaceTexture.getTimestamp();
    surfaceTexture.getTransformMatrix(transformMatrix);

    GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, frameBuffer);
    GLES20.glFramebufferTexture2D(
      GLES20.GL_FRAMEBUFFER,
      GLES20.GL_COLOR_ATTACHMENT0,
      GLES20.GL_TEXTURE_2D,
      outputTexId,
      0
    );
    GLES20.glClearColor(0,0,0,0);
    GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT);
    GLES20.glViewport(0, 0, width, height);
    textureRenderer.draw(inputTexId, transformMatrix);
    EGLUtils.checkGlError("GLFrameExtractor.draw()");
    GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, 0);
    return true;
  }


  /**
   * Get the name of the texture that contains the output frame.
   */
  public int getOutputTexId() {
    return outputTexId;
  }

  /**
   * Get the surface that can be used to render to the output texture.
   */
  public Surface getSurface() {
    return surface;
  }

  @Override
  public void onFrameAvailable(SurfaceTexture surfaceTexture) {
    frameAvailable.set(true);
    if (onFrameAvailableListener != null) {
      onFrameAvailableListener.onFrameAvailable();
    }
  }

  public long getLatestTimeStampNs() {
    return latestTimeStampNs;
  }

  public void release() {
    if (surfaceTexture != null) {
      surfaceTexture.release();
    }
    if (surface != null) {
      surface.release();
    }
    if (frameBuffer != -1) {
      GLES20.glDeleteFramebuffers(1, new int[]{frameBuffer}, 0);
    }
    if (inputTexId != -1) {
      GLES20.glDeleteTextures(2, new int[]{inputTexId, outputTexId}, 0);
    }
  }

  /**
   * A listener that will be called when a new frame is available.
   */
  public interface OnFrameAvailableListener {
    void onFrameAvailable();
  }
}
