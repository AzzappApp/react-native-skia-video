package com.azzapp.rnskv;

import android.graphics.SurfaceTexture;
import android.hardware.HardwareBuffer;
import android.opengl.GLES11Ext;
import android.opengl.GLES20;
import android.view.Surface;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * A class that extracts frames from a SurfaceTexture streaming to an external texture and renders
 * them to hardware buffers (see {@link HardwareBufferTexture}).
 */
public class GLFrameExtractor implements SurfaceTexture.OnFrameAvailableListener {

  /**
   * Number of hardware buffers the frames are rendered to in turn. A frame handed to JS is drawn
   * while the next ones are decoded (React Native Skia replays the canvas on its own threads), so
   * it must survive a couple of decodes before its buffer is reused.
   */
  private static final int OUTPUT_RING_CAPACITY = 3;

  private final AtomicBoolean frameAvailable = new AtomicBoolean(false);

  private final float[] transformMatrix = new float[16];

  private final Surface surface;

  private final SurfaceTexture surfaceTexture;

  private int frameWidth = -1;

  private int frameHeight = -1;

  private final int inputTexId;

  private final HardwareBufferTexture[] outputTextures =
    new HardwareBufferTexture[OUTPUT_RING_CAPACITY];

  private int nextOutputIndex = 0;

  private HardwareBufferTexture currentOutput;

  private final int frameBuffer;

  private final TextureRenderer textureRenderer;

  private OnFrameAvailableListener onFrameAvailableListener;

  private long latestTimeStampNs = -1;

  public GLFrameExtractor() {
    EGLUtils.purgeOpenGLError();

    int[] texIds = new int[1];
    GLES20.glGenTextures(1, texIds,0);

    inputTexId = texIds[0];
    EGLUtils.configureTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, inputTexId);

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
   * Decode the next frame and render it to the next output hardware buffer.
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
      releaseOutputTextures();
    }
    HardwareBufferTexture output = outputTextures[nextOutputIndex];
    if (output == null) {
      output = new HardwareBufferTexture(width, height);
      outputTextures[nextOutputIndex] = output;
    }
    nextOutputIndex = (nextOutputIndex + 1) % OUTPUT_RING_CAPACITY;

    surfaceTexture.updateTexImage();
    latestTimeStampNs = surfaceTexture.getTimestamp();
    surfaceTexture.getTransformMatrix(transformMatrix);

    GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, frameBuffer);
    GLES20.glFramebufferTexture2D(
      GLES20.GL_FRAMEBUFFER,
      GLES20.GL_COLOR_ATTACHMENT0,
      GLES20.GL_TEXTURE_2D,
      output.getTextureId(),
      0
    );
    GLES20.glClearColor(0,0,0,0);
    GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT);
    GLES20.glViewport(0, 0, width, height);
    textureRenderer.draw(inputTexId, transformMatrix);
    EGLUtils.checkGlError("GLFrameExtractor.draw()");
    GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, 0);
    // React Native Skia samples the hardware buffer without waiting on any
    // GPU fence: the rendering must be complete before the frame is handed out.
    GLES20.glFinish();
    currentOutput = output;
    return true;
  }


  /**
   * Get the hardware buffer that contains the last decoded frame.
   */
  public HardwareBuffer getOutputBuffer() {
    return currentOutput != null ? currentOutput.getHardwareBuffer() : null;
  }

  private void releaseOutputTextures() {
    for (int i = 0; i < OUTPUT_RING_CAPACITY; i++) {
      if (outputTextures[i] != null) {
        outputTextures[i].release();
        outputTextures[i] = null;
      }
    }
    nextOutputIndex = 0;
    currentOutput = null;
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
      GLES20.glDeleteTextures(1, new int[]{inputTexId}, 0);
    }
    releaseOutputTextures();
  }

  /**
   * A listener that will be called when a new frame is available.
   */
  public interface OnFrameAvailableListener {
    void onFrameAvailable();
  }
}
