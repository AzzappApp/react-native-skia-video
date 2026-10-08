package com.azzapp.rnskv;

import android.graphics.SurfaceTexture;
import android.hardware.HardwareBuffer;
import android.opengl.GLES11Ext;
import android.opengl.GLES20;
import android.view.Surface;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * A class that extracts frames from a SurfaceTexture streaming to an external texture and renders
 * them into hardware buffers that the GPU device shared by Skia and React Native WebGPU can import.
 */
public class GLFrameExtractor implements SurfaceTexture.OnFrameAvailableListener {

  private final AtomicBoolean frameAvailable = new AtomicBoolean(false);

  private final float[] transformMatrix = new float[16];

  private final Surface surface;

  private final SurfaceTexture surfaceTexture;

  private int frameWidth = -1;

  private int frameHeight = -1;

  /**
   * The number of output buffers the frames are rendered into, in turn. The
   * consumer copies a frame into its own texture right after it has been
   * decoded, but that copy runs asynchronously on the GPU: cycling through a
   * few buffers keeps the next frames from overwriting one still being read.
   */
  private static final int OUTPUT_BUFFER_COUNT = 3;

  private final int inputTexId;

  private final HardwareBufferTexture[] outputs = new HardwareBufferTexture[OUTPUT_BUFFER_COUNT];

  private int currentOutput = -1;

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
      releaseOutputs();
      for (int i = 0; i < OUTPUT_BUFFER_COUNT; i++) {
        outputs[i] = new HardwareBufferTexture(width, height);
      }
    }
    currentOutput = (currentOutput + 1) % OUTPUT_BUFFER_COUNT;
    HardwareBufferTexture output = outputs[currentOutput];
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
    // The buffer is read by another API (Vulkan, through Dawn) right after
    // this call: wait for GL to be done writing it.
    GLES20.glFinish();
    return true;
  }


  /**
   * Get the hardware buffer that contains the latest output frame.
   */
  public HardwareBuffer getOutputBuffer() {
    return currentOutput >= 0 ? outputs[currentOutput].getBuffer() : null;
  }

  private void releaseOutputs() {
    for (int i = 0; i < OUTPUT_BUFFER_COUNT; i++) {
      if (outputs[i] != null) {
        outputs[i].release();
        outputs[i] = null;
      }
    }
    currentOutput = -1;
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
    releaseOutputs();
  }

  /**
   * A listener that will be called when a new frame is available.
   */
  public interface OnFrameAvailableListener {
    void onFrameAvailable();
  }
}
