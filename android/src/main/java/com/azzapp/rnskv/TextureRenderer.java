package com.azzapp.rnskv;

import android.opengl.GLES11Ext;
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
      }
    """;

  private static final String FRAGMENT_SHADER =
    """
      precision highp float;
      uniform sampler2D uTexSampler;
      varying vec2 vTexCoords;
      void main() {
        gl_FragColor = texture2D(uTexSampler, vTexCoords);
      }
    """;

  private static final String FRAGMENT_SHADER_EXTERNAL =
    """
      #extension GL_OES_EGL_image_external : require
      precision highp float;
      uniform samplerExternalOES uTexSampler;
      varying vec2 vTexCoords;
      void main() {
        gl_FragColor = texture2D(uTexSampler, vTexCoords);
      }
    """;

  private static final String FRAGMENT_SHADER_EXTERNAL_HDR =
    """
      #extension GL_OES_EGL_image_external : require
      precision highp float;
      uniform samplerExternalOES uTexSampler;
      varying vec2 vTexCoords;

      // HLG Inverse OETF (De-gamma to linear light)
      vec3 hlg_to_linear(vec3 x) {
          const float a = 0.17883277;
          const float b = 0.28466892;
          const float c = 0.55991073;
          vec3 lin;
          for(int i=0; i<3; i++) {
              if(x[i] <= 0.5) {
                  lin[i] = (x[i] * x[i]) / 3.0;
              } else {
                  lin[i] = (exp((x[i] - c) / a) + b) / 12.0;
              }
          }
          return lin;
      }

      // SDR OETF (Standard Rec.709 curve)
      vec3 linear_to_sdr(vec3 x) {
          vec3 result;
          for(int i = 0; i < 3; i++) {
              if (x[i] < 0.018) {
                  result[i] = 4.5 * x[i];
              } else {
                  result[i] = 1.099 * pow(x[i], 0.45) - 0.099;
              }
          }
          return result;
      }

      void main() {
        vec4 texColor = texture2D(uTexSampler, vTexCoords);
        vec3 rgb2020_nonlinear = texColor.rgb;

        // Linearize the HLG colors
        vec3 rgb2020_linear = hlg_to_linear(rgb2020_nonlinear);

        // Color Gamut Conversion Matrix (BT.2020 -> BT.709)
        mat3 mat_2020_to_709 = mat3(
            1.6605, -0.1245, -0.0182,
           -0.5852,  1.1329, -0.1006,
           -0.0753, -0.0084,  1.1188
        );
        vec3 rgb709_linear = mat_2020_to_709 * rgb2020_linear;

        // Simple Tone Mapping (Clamp highlights so they don't blow out)
        rgb709_linear = clamp(rgb709_linear, 0.0, 1.0);

         // Apply standard SDR gamma curves
        vec3 rgb709_nonlinear = linear_to_sdr(rgb709_linear);

        gl_FragColor = vec4(rgb709_nonlinear, 1.0);
      }
    """;

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

  boolean external = false;


  public TextureRenderer() {
    this(false, false);
  }

  /**
   * Create a new TextureRenderer.
   */
  public TextureRenderer(boolean external, boolean isHdr) {
    this.external = external;
    program = EGLUtils.createProgram(
      VERTEX_SHADER,
      external ? (!isHdr ? FRAGMENT_SHADER_EXTERNAL : FRAGMENT_SHADER_EXTERNAL_HDR) : FRAGMENT_SHADER
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
    GLES20.glBindTexture(
      external ? GLES11Ext.GL_TEXTURE_EXTERNAL_OES : GLES20.GL_TEXTURE_2D, textureId);
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
