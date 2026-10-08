#pragma once

#include <EGL/egl.h>
#include <EGL/eglext.h>
#include <GLES2/gl2.h>
#include <android/hardware_buffer.h>
#include <mutex>
#include <unordered_map>
#include <vector>

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

/**
 * Creates a sync fence (a sync_file) signaled once the GL commands issued so
 * far on the current context are complete, and flushes them. Waits for them
 * on the CPU (glFinish) and returns -1 without EGL_ANDROID_native_fence_sync.
 */
int createSyncFence();

/**
 * The fences guarding the hardware buffers the decoders render frames into,
 * shared between their GL contexts and React Native Skia's Vulkan device:
 * - the ready fence, signaled when GL is done rendering the frame, that
 *   Vulkan waits for before reading the buffer;
 * - the release fences, signaled when Vulkan is done reading the buffer,
 *   that GL waits for before rendering into it again.
 * The registry owns the fds.
 */
class HardwareBufferFences {
public:
  static HardwareBufferFences& getInstance();

  /** Sets the ready fence of `buffer`, closing an untaken previous one. */
  void setReadyFence(AHardwareBuffer* buffer, int fd);

  /** Takes the ready fence of `buffer` (the caller owns it), or -1. */
  int takeReadyFence(AHardwareBuffer* buffer);

  /**
   * Returns a duplicate of the ready fence of `buffer` (the caller owns it),
   * or -1. The fence stays registered until the buffer is rendered into
   * again: every frame handed out for that rendering carries it.
   */
  int dupReadyFence(AHardwareBuffer* buffer);

  /**
   * Sets the release fences of `buffer`, replacing (closing) the previous
   * ones. Closes them if `buffer` is not a registered buffer.
   */
  void setReleaseFences(AHardwareBuffer* buffer, std::vector<int> fds);

  /** Takes the release fences of `buffer` (the caller owns them). */
  std::vector<int> takeReleaseFences(AHardwareBuffer* buffer);

  /** Unregisters `buffer`, closing its fences. */
  void forget(AHardwareBuffer* buffer);

private:
  struct Fences {
    int ready = -1;
    std::vector<int> release;
  };
  std::mutex mutex;
  std::unordered_map<AHardwareBuffer*, Fences> fences;
};

} // namespace RNSkiaVideo
