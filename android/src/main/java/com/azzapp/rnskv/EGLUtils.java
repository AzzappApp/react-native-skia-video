package com.sheunglaili.rnskv;

import android.graphics.Bitmap;
import android.opengl.GLES20;
import android.opengl.GLU;
import android.opengl.Matrix;
import android.util.Log;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.FloatBuffer;

import javax.microedition.khronos.egl.EGL10;
import javax.microedition.khronos.egl.EGLContext;

public class EGLUtils {

  /**
   * The EGL constant for the client version of the context.
   */
  public static final int EGL_CONTEXT_CLIENT_VERSION = 0x3098;

  /**
   * The EGL constant for the recordable attribute.
   */
  public static final int EGL_RECORDABLE_ANDROID = 0x3142;


  public static final float[] IDENTITY_MATRIX = new float[16];

  static {
    Matrix.setIdentityM(IDENTITY_MATRIX, 0);
  }

  static public EGLContext getCurrentContextOrThrows() {
    EGLContext context = ((EGL10) EGLContext.getEGL()).eglGetCurrentContext();
    if (context == EGL10.EGL_NO_CONTEXT) {
      throw new RuntimeException("Skia context is not initialized");
    }
    return context;
  }

  /**
   * Create an OpenGL program from the given vertex and fragment shaders.
   *
   * @param vertexSource   the vertex shader source code
   * @param fragmentSource the fragment shader source code
   * @return the program identifier
   */
  public static int createProgram(String vertexSource, String fragmentSource) {
    int vertexShader = loadShader(GLES20.GL_VERTEX_SHADER, vertexSource);
    if (vertexShader == 0) {
      return 0;
    }
    int fragmentShared = loadShader(GLES20.GL_FRAGMENT_SHADER, fragmentSource);
    if (fragmentShared == 0) {
      return 0;
    }
    int program = GLES20.glCreateProgram();
    if (program != 0) {
      GLES20.glAttachShader(program, vertexShader);
      GLES20.glAttachShader(program, fragmentShared);
      GLES20.glLinkProgram(program);
      int[] linkStatus = new int[1];
      GLES20.glGetProgramiv(
        program, GLES20.GL_LINK_STATUS, linkStatus,
        0
      );
      if (linkStatus[0] != GLES20.GL_TRUE) {
        String info = GLES20.glGetProgramInfoLog(program);
        GLES20.glDeleteProgram(program);
        throw new RuntimeException("Could not link program: " + info);
      }
    }
    return program;
  }

  /**
   * Load a shader from the given source code.
   *
   * @param shaderType the type of the shader, e.g. {@link GLES20#GL_VERTEX_SHADER} or
   *                   {@link GLES20#GL_FRAGMENT_SHADER}
   * @param source     the source code of the shader
   * @return the shader identifier
   */
  public static int loadShader(int shaderType, String source) {
    int shader = GLES20.glCreateShader(shaderType);
    if (shader != 0) {
      GLES20.glShaderSource(shader, source);
      GLES20.glCompileShader(shader);
      int[] compiled = new int[1];
      GLES20.glGetShaderiv(shader, GLES20.GL_COMPILE_STATUS, compiled, 0);
      if (compiled[0] == 0) {
        String info = GLES20.glGetShaderInfoLog(shader);
        GLES20.glDeleteShader(shader);
        throw new RuntimeException("Could not compile shader " + shaderType + ":" + info);
      }
    }
    return shader;
  }

  /**
   * Create a float buffer from the given values.
   *
   * @param values the values to put in the buffer
   * @return the float buffer
   */
  public static FloatBuffer createFloatBuffer(float... values) {
    ByteBuffer byteBuffer = ByteBuffer.allocateDirect(
      values.length * 4
    );
    byteBuffer.order(ByteOrder.nativeOrder());
    FloatBuffer floatBuffer = byteBuffer.asFloatBuffer();
    floatBuffer.put(values);
    floatBuffer.position(0);
    return floatBuffer;
  }


  /**
   * Purge all OpenGL errors.
   * Useful to call this method before starting a new OpenGL operation.
   * Especially since react-native-skia seems to leave some errors behind.
   */
  public static void purgeOpenGLError() {
    int i = 0;
    while (true) {
      if (GLES20.glGetError() == GLES20.GL_NO_ERROR || i >= 9) {
        break;
      }
      i++;
    }
  }

  /**
   * Check for OpenGL errors and throw an exception if an error is found.
   *
   * @param prefix the prefix to add to the error message
   */
  public static void checkGlError(String prefix) {
    StringBuilder errorMessageBuilder = new StringBuilder();
    boolean foundError = false;
    int error;
    if (prefix != null) {
      errorMessageBuilder.append(prefix).append(": ");
    }
    while ((error = GLES20.glGetError()) != GLES20.GL_NO_ERROR) {
      if (foundError) {
        errorMessageBuilder.append('\n');
      }
      String errorString = GLU.gluErrorString(error);
      if (errorString == null) {
        errorString = "error code: 0x" + Integer.toHexString(error);
      } else {
        errorString = "error code: 0x" + Integer.toHexString(error) + " " + errorString;
      }
      errorMessageBuilder.append("glError: ").append(errorString);
      foundError = true;
    }
    if (foundError) {
      if (BuildConfig.DEBUG) {
        throw new RuntimeException(errorMessageBuilder.toString());
      } else {
        Log.e("RNSkiaVideo", errorMessageBuilder.toString());
      }
    }
  }

  /**
   * Binds the texture of the given type with default configuration of GL_LINEAR filtering and
   * GL_CLAMP_TO_EDGE wrapping.
   *
   * @param target The target to which the texture is bound, e.g. {@link GLES20#GL_TEXTURE_2D}
   *               for a two-dimensional texture or {@link android.opengl.GLES11Ext#GL_TEXTURE_EXTERNAL_OES}
   *               for an external texture.
   * @param texId The texture identifier.
   */
  public static void configureTexture(int target, int texId) {
    GLES20.glBindTexture(target, texId);
    GLES20.glTexParameteri(target, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR);
    GLES20.glTexParameteri(target, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR);
    GLES20.glTexParameteri(target, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE);
    GLES20.glTexParameteri(target, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE);
  }

  /**
   * Save the texture to a bitmap. (Useful for debugging purposes)
   *
   * @param texture the texture identifier
   * @param width   the width of the texture
   * @param height  the height of the texture
   */
  public static Bitmap saveTexture(int texture, int width, int height) {
    int[] frame = new int[1];
    GLES20.glGenFramebuffers(1, frame, 0);
    GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, frame[0]);
    GLES20.glFramebufferTexture2D(
      GLES20.GL_FRAMEBUFFER,
      GLES20.GL_COLOR_ATTACHMENT0, GLES20.GL_TEXTURE_2D, texture,
      0
    );
    ByteBuffer buffer = ByteBuffer.allocate(width * height * 4);
    GLES20.glReadPixels(
      0, 0, width, height, GLES20.GL_RGBA,
      GLES20.GL_UNSIGNED_BYTE, buffer
    );
    Bitmap bitmap = Bitmap.createBitmap(
      width, height,
      Bitmap.Config.ARGB_8888
    );
    bitmap.copyPixelsFromBuffer(buffer);
    GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, 0);
    GLES20.glDeleteFramebuffers(1, frame, 0);
    return bitmap;
  }
}
