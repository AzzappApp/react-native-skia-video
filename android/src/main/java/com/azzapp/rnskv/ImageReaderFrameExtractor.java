package com.azzapp.rnskv;

import android.graphics.ImageFormat;
import android.graphics.Rect;
import android.hardware.HardwareBuffer;
import android.hardware.SyncFence;
import android.media.Image;
import android.media.ImageReader;
import android.os.Build;
import android.util.Log;
import android.view.Surface;

import androidx.annotation.RequiresApi;

import java.io.IOException;
import java.time.Duration;
import java.util.ArrayDeque;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Receives the frames of a decoder in GPU-sampleable buffers, in the decoder's own YUV layout
 * ({@link ImageFormat#PRIVATE}). JS converts them to RGB on React Native Skia's device: unlike
 * {@link GLFrameExtractor}, there is no OpenGL pass into an RGBA buffer.
 */
@RequiresApi(api = Build.VERSION_CODES.Q)
public class ImageReaderFrameExtractor implements ImageReader.OnImageAvailableListener {

  private static final String TAG = "ImageReaderFrameExtractor";

  /**
   * The images kept acquired once a newer one replaced them. JS converts a frame with GPU commands
   * it does not wait for, and the decoder renders into the buffer of a closed image right away:
   * the delay leaves the GPU a couple of frames to be done reading it.
   */
  private static final int RETAINED_IMAGES = 2;

  /**
   * The current image, the retained ones, and the two more acquireLatestImage needs to skip to
   * the latest image.
   */
  private static final int MAX_IMAGES = RETAINED_IMAGES + 3;

  private final ImageReader reader;

  private final AtomicBoolean imageAvailable = new AtomicBoolean(false);

  private final ArrayDeque<AcquiredImage> retainedImages = new ArrayDeque<>();

  private AcquiredImage currentImage;

  private GLFrameExtractor.OnFrameAvailableListener onFrameAvailableListener;

  /**
   * @param width  the width of the decoded frames (the decoder sets the size of its buffers)
   * @param height the height of the decoded frames
   */
  public ImageReaderFrameExtractor(int width, int height) {
    reader = ImageReader.newInstance(
      width, height, ImageFormat.PRIVATE, MAX_IMAGES, HardwareBuffer.USAGE_GPU_SAMPLED_IMAGE);
    // Called on the looper of the calling thread, like the frames of a SurfaceTexture.
    reader.setOnImageAvailableListener(this, null);
  }

  public void setOnFrameAvailableListener(
    GLFrameExtractor.OnFrameAvailableListener onFrameAvailableListener
  ) {
    this.onFrameAvailableListener = onFrameAvailableListener;
  }

  /**
   * @return the surface the decoder renders the frames to
   */
  public Surface getSurface() {
    return reader.getSurface();
  }

  /**
   * Acquires the latest frame rendered by the decoder.
   *
   * @return true if a new frame was acquired, false otherwise
   */
  public boolean decodeNextFrame() {
    if (!imageAvailable.getAndSet(false)) {
      return false;
    }
    Image image;
    try {
      image = reader.acquireLatestImage();
    } catch (IllegalStateException e) {
      Log.w(TAG, "Could not acquire a decoded frame", e);
      return false;
    }
    if (image == null) {
      return false;
    }
    HardwareBuffer buffer = image.getHardwareBuffer();
    if (buffer == null) {
      image.close();
      return false;
    }
    waitUntilWritten(image);
    if (currentImage != null) {
      retainedImages.addLast(currentImage);
      while (retainedImages.size() > RETAINED_IMAGES) {
        retainedImages.removeFirst().close();
      }
    }
    currentImage = new AcquiredImage(image, buffer);
    return true;
  }

  // A decoder may hand a frame over before it is done writing it, with a fence: it is only
  // reported from Android 13 on.
  private static void waitUntilWritten(Image image) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
      return;
    }
    try (SyncFence fence = image.getFence()) {
      if (fence.isValid() && !fence.await(Duration.ofSeconds(1))) {
        Log.w(TAG, "A decoded frame was not written after 1 second");
      }
    } catch (IOException e) {
      Log.w(TAG, "Could not wait for a decoded frame to be written", e);
    }
  }

  /**
   * @return the buffer of the last acquired frame
   */
  public HardwareBuffer getOutputBuffer() {
    return currentImage != null ? currentImage.buffer : null;
  }

  /**
   * The region of the buffer of the last acquired frame holding the frame: decoders pad their
   * buffers (a 1080p frame in a 1088 rows buffer). The image only reports the padding on some
   * devices, so the region is also limited to the size of the video.
   *
   * @param videoWidth  the width of the video, as stored
   * @param videoHeight the height of the video, as stored
   */
  public Rect getCropRect(int videoWidth, int videoHeight) {
    if (currentImage == null) {
      return new Rect();
    }
    Rect crop = currentImage.image.getCropRect();
    crop.right = Math.min(crop.right, crop.left + videoWidth);
    crop.bottom = Math.min(crop.bottom, crop.top + videoHeight);
    return crop;
  }

  public long getLatestTimeStampNs() {
    return currentImage != null ? currentImage.image.getTimestamp() : -1;
  }

  @Override
  public void onImageAvailable(ImageReader reader) {
    imageAvailable.set(true);
    if (onFrameAvailableListener != null) {
      onFrameAvailableListener.onFrameAvailable();
    }
  }

  /**
   * Closes the acquired frames and the reader. The decoder must be released first.
   */
  public void release() {
    if (currentImage != null) {
      currentImage.close();
      currentImage = null;
    }
    while (!retainedImages.isEmpty()) {
      retainedImages.removeFirst().close();
    }
    reader.close();
  }

  private static final class AcquiredImage {
    private final Image image;
    private final HardwareBuffer buffer;

    AcquiredImage(Image image, HardwareBuffer buffer) {
      this.image = image;
      this.buffer = buffer;
    }

    void close() {
      buffer.close();
      image.close();
    }
  }
}
