package com.azzapp.rnskv;

import android.opengl.GLES20;

import java.nio.FloatBuffer;

/**
 * A class that renders a texture.
 */
public class TextureRenderer {

  private static final String VERTEX_SHADER =
    """
      attribute vec4 aFramePosition;
      attribute vec4 aTexCoords;
      uniform mat4 uTexTransform;
      varying vec2 vTexCoords;
      void main() {
      gl_Position = aFramePosition;
      vTexCoords = (uTexTransform * aTexCoords).xy;
      }""";

  private static final String FRAGMENT_SHADER =
    """
      precision highp float;
      uniform sampler2D uTexSampler;
      varying vec2 vTexCoords;
      void main() {
      gl_FragColor = texture2D(uTexSampler, vTexCoords);
      }""";

  private static final FloatBuffer POS_VERTICES = EGLUtils.createFloatBuffer(
    -1f, -1f, 0f, 1f,
    1f, -1f, 0f, 1f,
    -1f, 1f, 0f, 1f,
    1f, 1f, 0f, 1f
  );

  private static final FloatBuffer TEX_VERTICES = EGLUtils.createFloatBuffer(
    0f, 1f, 0f, 1f,
    1f, 1f, 0f, 1f,
    0f, 0f, 0f, 1f,
    1f, 0f, 0f, 1f
  );

  private final int program;

  private final int aFramePositionLoc;

  private final int aTexCoordsLoc;

  private final int uTexTransformLoc;

  private final int uTexSamplerLoc;

  /**
   * Create a new TextureRenderer.
   */
  public TextureRenderer() {
    program = EGLUtils.createProgram(
      VERTEX_SHADER,
      FRAGMENT_SHADER
    );

    aFramePositionLoc = GLES20.glGetAttribLocation(
      program,
      "aFramePosition"
    );
    aTexCoordsLoc = GLES20.glGetAttribLocation(
      program,
      "aTexCoords"
    );
    uTexTransformLoc = GLES20.glGetUniformLocation(
      program,
      "uTexTransform"
    );

    uTexSamplerLoc = GLES20.glGetUniformLocation(
      program,
      "uTexSampler"
    );
  }

  /**
   * Draw the texture.
   *
   * @param textureId       the texture to draw
   * @param transformMatrix the texture transform matrix to apply
   *                        (usually the texture matrix from a SurfaceTexture)
   */
  public void draw(
    int textureId,
    float[] transformMatrix
  ) {
    GLES20.glUseProgram(program);

    GLES20.glEnableVertexAttribArray(aFramePositionLoc);
    GLES20.glVertexAttribPointer(
      aFramePositionLoc, 4, GLES20.GL_FLOAT, false, 0,
      POS_VERTICES
    );

    GLES20.glEnableVertexAttribArray(aTexCoordsLoc);
    GLES20.glVertexAttribPointer(
      aTexCoordsLoc, 4, GLES20.GL_FLOAT, false, 0,
      TEX_VERTICES
    );

    GLES20.glUniformMatrix4fv(uTexTransformLoc, 1, false, transformMatrix, 0);

    GLES20.glActiveTexture(GLES20.GL_TEXTURE0);
    GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, textureId);
    GLES20.glUniform1i(uTexSamplerLoc, 0);

    GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4);

    GLES20.glDisableVertexAttribArray(aFramePositionLoc);
    GLES20.glDisableVertexAttribArray(aTexCoordsLoc);
  }

  /**
   * Release the resources. (delete the program)
   */
  public void release() {
    GLES20.glDeleteProgram(program);
  }
}
