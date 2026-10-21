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

/**
 * Makes the current GL context wait, on the GPU, for the sync fence `fd` (a
 * sync_file, e.g. exported by Vulkan when it is done writing a hardware
 * buffer) before running the commands issued after this call. Falls back to
 * waiting on the CPU without EGL_ANDROID_native_fence_sync.
 *
 * Takes ownership of `fd`. A negative `fd` is an already signaled fence.
 */
void waitForSyncFence(int fd);

} // namespace RNSkiaVideo
