#pragma once

#include "VideoFrame.h"
#include <EGL/egl.h>
#include <EGL/eglext.h>
#include <GLES2/gl2.h>
#include <android/hardware_buffer.h>
#include <fbjni/fbjni.h>

namespace RNSkiaVideo {
using namespace facebook::jni;

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
 * buffer) before running the commands issued after this call. Without a
 * current context, EGL_ANDROID_native_fence_sync or EGL_KHR_wait_sync, or if
 * the GPU wait fails, waits on the CPU instead, for 1 second at most.
 *
 * Takes ownership of `fd`. A negative `fd` is an already signaled fence.
 *
 * @return false if the fence could not be waited for: neither on the GPU nor,
 * within the timeout, on the CPU. The buffer must not be read then.
 */
bool waitForSyncFence(int fd);

/**
 * The native methods of com.azzapp.rnskv.HardwareBufferTexture.
 */
struct JHardwareBufferTexture : JavaClass<JHardwareBufferTexture> {
  static constexpr auto kJavaDescriptor =
      "Lcom/azzapp/rnskv/HardwareBufferTexture;";

  static void registerNatives();

  static jlong
  nativeBindHardwareBuffer(alias_ref<JClass>,
                           alias_ref<JHardwareBuffer> hardwareBuffer,
                           jint texture);

  static void nativeDestroyImage(alias_ref<JClass>, jlong image);
};

} // namespace RNSkiaVideo
