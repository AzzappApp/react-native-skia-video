#pragma once

#include <EGL/egl.h>
#include <EGL/eglext.h>
#include <GLES2/gl2.h>
#include <android/hardware_buffer.h>

namespace RNSkiaVideo {

/**
 * Wraps `buffer` in an EGLImage and binds it as the storage of the
 * GL_TEXTURE_2D `texture` of the current GL context: rendering into the
 * texture writes into the buffer, sampling it reads the buffer.
 *
 * @return the EGLImage, to destroy with `destroyHardwareBufferImage` once the
 * texture is not used anymore, or EGL_NO_IMAGE_KHR on failure.
 */
EGLImageKHR bindHardwareBufferToTexture(AHardwareBuffer* buffer,
                                        GLuint texture);

/**
 * Destroys an EGLImage created by `bindHardwareBufferToTexture`.
 */
void destroyHardwareBufferImage(EGLImageKHR image);

} // namespace RNSkiaVideo
