package com.azzapp.rnskv;

import android.hardware.HardwareBuffer;
import android.opengl.GLES20;

/**
 * A GL_TEXTURE_2D backed by an RGBA {@link HardwareBuffer} (through an
 * EGLImage). OpenGL renders into it (or samples it), and the GPU device shared
 * by Skia and React Native WebGPU imports the very same memory
 * (GPUDevice.importSharedTextureMemory), without any copy.
 * <p>
 * Must be created and released with an EGL context current on the calling
 * thread.
 */
public class HardwareBufferTexture {

  static {
    System.loadLibrary("react-native-skia-video");
  }

  private final HardwareBuffer buffer;

  private final int width;

  private final int height;

  private final int textureId;

  private long eglImage;

  public HardwareBufferTexture(int width, int height) {
    this.width = width;
    this.height = height;
    buffer = HardwareBuffer.create(
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
    eglImage = nativeBindHardwareBufferToTexture(buffer, textureId);
    if (eglImage == 0) {
      GLES20.glDeleteTextures(1, texIds, 0);
      buffer.close();
      throw new RuntimeException("Could not bind the hardware buffer to a GL texture");
    }
  }

  public HardwareBuffer getBuffer() {
    return buffer;
  }

  public int getTextureId() {
    return textureId;
  }

  public int getWidth() {
    return width;
  }

  public int getHeight() {
    return height;
  }

  public void release() {
    if (eglImage != 0) {
      GLES20.glDeleteTextures(1, new int[]{textureId}, 0);
      nativeDestroyImage(eglImage);
      eglImage = 0;
      buffer.close();
    }
  }

  private static native long nativeBindHardwareBufferToTexture(HardwareBuffer buffer, int textureId);

  private static native void nativeDestroyImage(long eglImage);
}
