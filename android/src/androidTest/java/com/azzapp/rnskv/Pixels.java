package com.azzapp.rnskv;

import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import android.opengl.GLES20;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;

/**
 * Reads back what a frame's texture holds, from any context sharing it: the
 * test videos are flat greys that say which frame they are.
 */
final class Pixels {

  // Two encodes and a YUV to RGB conversion; neighbouring frames are 8 apart.
  static final int TOLERANCE = 3;

  private Pixels() {
  }

  /** The red, green and blue of the texture's centre. */
  static int[] center(int texture, int width, int height) {
    return at(texture, width / 2, height / 2);
  }

  /**
   * Where the source's marker is in the frame, in the frame's own rows:
   * {left, top} as booleans, "top" being the row the unrotated frame has
   * the marker in.
   */
  static boolean[] marker(VideoFrame frame) {
    int w = frame.getWidth();
    int h = frame.getHeight();
    int[][] corners = {{w / 8, h / 8}, {w - w / 8, h / 8}, {w / 8, h - h / 8}, {w - w / 8, h - h / 8}};
    int background = center(frame.getTexture(), w, h)[0];
    assertTrue("frame too bright to find the marker: " + background, background < 200);
    int found = -1;
    for (int i = 0; i < corners.length; i++) {
      if (at(frame.getTexture(), corners[i][0], corners[i][1])[0] > background + 50) {
        assertTrue("marker in two corners", found < 0);
        found = i;
      }
    }
    assertTrue("no marker in any corner", found >= 0);
    return new boolean[]{found % 2 == 0, found < 2};
  }

  private static int[] at(int texture, int x, int y) {
    int[] fbo = new int[1];
    GLES20.glGenFramebuffers(1, fbo, 0);
    try {
      GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, fbo[0]);
      GLES20.glFramebufferTexture2D(
        GLES20.GL_FRAMEBUFFER, GLES20.GL_COLOR_ATTACHMENT0, GLES20.GL_TEXTURE_2D, texture, 0);
      int status = GLES20.glCheckFramebufferStatus(GLES20.GL_FRAMEBUFFER);
      assertTrue("texture " + texture + " is not readable: " + status,
        status == GLES20.GL_FRAMEBUFFER_COMPLETE);
      ByteBuffer pixel = ByteBuffer.allocateDirect(4).order(ByteOrder.nativeOrder());
      GLES20.glReadPixels(x, y, 1, 1, GLES20.GL_RGBA, GLES20.GL_UNSIGNED_BYTE, pixel);
      return new int[]{pixel.get(0) & 0xff, pixel.get(1) & 0xff, pixel.get(2) & 0xff};
    } finally {
      GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, 0);
      GLES20.glDeleteFramebuffers(1, fbo, 0);
    }
  }

  /**
   * The red of an external texture (a decoder's buffer) at normalized
   * coordinates, v = 0 being the buffer's first row, as Skia samples it.
   */
  static int externalAt(int texture, float u, float v) {
    int[] target = new int[1];
    GLES20.glGenTextures(1, target, 0);
    int[] fbo = new int[1];
    GLES20.glGenFramebuffers(1, fbo, 0);
    TextureRenderer renderer = new TextureRenderer(true);
    try {
      GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, target[0]);
      GLES20.glTexImage2D(GLES20.GL_TEXTURE_2D, 0, GLES20.GL_RGBA, 8, 8, 0,
        GLES20.GL_RGBA, GLES20.GL_UNSIGNED_BYTE, null);
      GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, fbo[0]);
      GLES20.glFramebufferTexture2D(
        GLES20.GL_FRAMEBUFFER, GLES20.GL_COLOR_ATTACHMENT0, GLES20.GL_TEXTURE_2D, target[0], 0);
      GLES20.glViewport(0, 0, 8, 8);
      // Every fragment samples (u, v).
      float[] matrix = new float[16];
      matrix[10] = 1;
      matrix[12] = u;
      matrix[13] = v;
      matrix[15] = 1;
      renderer.draw(texture, matrix);
      ByteBuffer pixel = ByteBuffer.allocateDirect(4).order(ByteOrder.nativeOrder());
      GLES20.glReadPixels(4, 4, 1, 1, GLES20.GL_RGBA, GLES20.GL_UNSIGNED_BYTE, pixel);
      return pixel.get(0) & 0xff;
    } finally {
      renderer.release();
      GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, 0);
      GLES20.glDeleteFramebuffers(1, fbo, 0);
      GLES20.glDeleteTextures(1, target, 0);
    }
  }

  /** The frame shows, in its pixels, the frame its timestamp names. */
  static void assertShowsItsFrame(String label, VideoFrame frame, int fps) {
    assertNotNull(label + ": no frame", frame);
    int index = (int) Math.round(frame.getTimestampNs() / 1e9 * fps);
    int expected = TestVideo.gray(index);
    int[] rgb = center(frame.getTexture(), frame.getWidth(), frame.getHeight());
    for (int channel : rgb) {
      assertTrue(
        label + ": frame " + index + " reads (" + rgb[0] + "," + rgb[1] + "," + rgb[2]
          + "), expected grey " + expected,
        Math.abs(channel - expected) <= TOLERANCE);
    }
  }
}
