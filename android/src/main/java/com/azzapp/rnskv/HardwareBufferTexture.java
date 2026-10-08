package com.azzapp.rnskv;

import android.hardware.HardwareBuffer;
import android.opengl.GLES20;

/**
 * An OpenGL texture whose storage is a {@link HardwareBuffer}.
 * <p>
 * The hardware buffer is GPU-only memory shared between OpenGL and React
 * Native Skia's device (Vulkan), without copy: decoded frames are rendered
 * into such textures for Skia to read them, and Skia draws exported frames
 * into one that the encoder reads.
 * <p>
 * Must be created and released with the same GL context current.
 */
public class HardwareBufferTexture {

  private final HardwareBuffer hardwareBuffer;

  private final int width;

  private final int height;

  private final int textureId;

  private long eglImage;

  /**
   * Allocates an RGBA hardware buffer of the given size and binds it to a new
   * texture of the current GL context.
   */
  public HardwareBufferTexture(int width, int height) {
    this.width = width;
    this.height = height;
    // RGBA_8888 is the format React Native Skia imports hardware buffers as.
    hardwareBuffer = HardwareBuffer.create(
      width,
      height,
      HardwareBuffer.RGBA_8888,
      1,
      HardwareBuffer.USAGE_GPU_SAMPLED_IMAGE | HardwareBuffer.USAGE_GPU_COLOR_OUTPUT
    );
    int[] texIds = new int[1];
    GLES20.glGenTextures(1, texIds, 0);
    textureId = texIds[0];
    EGLUtils.configureTexture(GLES20.GL_TEXTURE_2D, textureId);
    eglImage = nativeBindHardwareBuffer(hardwareBuffer, textureId);
    if (eglImage == 0) {
      release();
      throw new RuntimeException("Could not bind the hardware buffer to an OpenGL texture");
    }
  }

  /**
   * @return the hardware buffer backing the texture
   */
  public HardwareBuffer getHardwareBuffer() {
    return hardwareBuffer;
  }

  /**
   * @return the name of the texture
   */
  public int getTextureId() {
    return textureId;
  }

  public int getWidth() {
    return width;
  }

  public int getHeight() {
    return height;
  }

  /**
   * Makes the current GL context wait (on the GPU) until React Native Skia's
   * device is done reading the frame previously rendered into the buffer, see
   * {@link #signalReady()}. Must be called before rendering into the buffer.
   */
  public void waitForRelease() {
    nativeWaitForRelease(hardwareBuffer);
  }

  /**
   * Flushes the GL commands rendering into the buffer and creates the fence
   * signaled once they are complete: the frame handed to JS carries it, and
   * React Native Skia's device waits for it (on the GPU) before reading the
   * buffer. JS hands back the fences signaled once the buffer is read, that
   * {@link #waitForRelease()} waits for.
   */
  public void signalReady() {
    nativeSignalReady(hardwareBuffer);
  }

  /**
   * Releases the texture and this object's reference on the hardware buffer.
   * (frames handed to JS keep their own reference on the buffer)
   */
  public void release() {
    GLES20.glDeleteTextures(1, new int[]{textureId}, 0);
    if (eglImage != 0) {
      nativeDestroyImage(eglImage);
      eglImage = 0;
    }
    if (!hardwareBuffer.isClosed()) {
      nativeForget(hardwareBuffer);
      hardwareBuffer.close();
    }
  }

  private static native long nativeBindHardwareBuffer(HardwareBuffer hardwareBuffer, int textureId);

  private static native void nativeDestroyImage(long eglImage);

  private static native void nativeWaitForRelease(HardwareBuffer hardwareBuffer);

  private static native void nativeSignalReady(HardwareBuffer hardwareBuffer);

  private static native void nativeForget(HardwareBuffer hardwareBuffer);
}
