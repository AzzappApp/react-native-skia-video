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

import java.io.IOException;
import java.time.Duration;
import java.util.ArrayDeque;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Receives the frames of a decoder in GPU-sampleable buffers, in the decoder's own YUV layout
 * ({@link ImageFormat#PRIVATE}). JS converts them to RGB on React Native Skia's device.
 */
public class ImageReaderFrameExtractor implements ImageReader.OnImageAvailableListener {

  private static final String TAG = "ImageReaderFrameExtractor";

  /**
   * The images kept acquired once a newer one replaced them. JS converts a frame with GPU commands
   * it does not wait for, and the decoder renders into the buffer of a closed image right away:
   * the delay leaves the GPU a couple of frames to be done reading it.
   */
  private static final int RETAINED_IMAGES = 2;

  /**
   * The current image, the retained ones, the one waited for (see {@link #pendingImage}) and the
   * two more acquireLatestImage needs to skip to the latest image.
   */
  private static final int MAX_IMAGES = RETAINED_IMAGES + 4;

  /**
   * How long a frame is waited for, once its decoder handed it over, before it is taken as
   * written.
   */
  private static final long WRITE_TIMEOUT_NS = 1_000_000_000L;

  private final ImageReader reader;

  /**
   * Whether {@link #decodeNextFrame} waits for the decoder to be done writing a frame, rather
   * than handing it out with a later call.
   */
  private final boolean waitsForFrames;

  private final AtomicBoolean imageAvailable = new AtomicBoolean(false);

  private final ArrayDeque<AcquiredImage> retainedImages = new ArrayDeque<>();

  private AcquiredImage currentImage;

  /**
   * A frame acquired while its decoder was still writing it, handed out by a later
   * {@link #decodeNextFrame} (see {@link #waitsForFrames}).
   */
  private Image pendingImage;

  /**
   * When the oldest frame not handed out since was found being written (System.nanoTime).
   */
  private long pendingSinceNs;

  private OnFrameAvailableListener onFrameAvailableListener;

  /**
   * @param width          the width of the decoded frames (the decoder sets the size of its
   *                       buffers)
   * @param height         the height of the decoded frames
   * @param waitsForFrames whether {@link #decodeNextFrame} blocks, up to a second, while the
   *                       decoder is writing the frame: for an export, which needs each frame
   *                       when it asks for it. A player calls it on the UI thread, every display
   *                       frame: it gets the frame with a later call instead.
   */
  public ImageReaderFrameExtractor(int width, int height, boolean waitsForFrames) {
    this.waitsForFrames = waitsForFrames;
    // The buffers must be sampleable by the GPU: React Native Skia's device imports them as
    // textures. Android 10 lets the reader ask for it. On Android 9 the reader asks for nothing,
    // and the buffers carry the usage of the decoder alone, which renders to a surface for the
    // GPU (MediaCodec's default output usage includes GPU sampling): a decoder that doesn't
    // fails the import of its frames.
    reader = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
      ? ImageReader.newInstance(
          width, height, ImageFormat.PRIVATE, MAX_IMAGES, HardwareBuffer.USAGE_GPU_SAMPLED_IMAGE)
      : ImageReader.newInstance(width, height, ImageFormat.PRIVATE, MAX_IMAGES);
    // Called on the looper of the calling thread.
    reader.setOnImageAvailableListener(this, null);
  }

  public void setOnFrameAvailableListener(OnFrameAvailableListener onFrameAvailableListener) {
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
    // The frame waited for, if it is written by now.
    Image image = null;
    if (pendingImage != null && isWritten(pendingImage)) {
      image = pendingImage;
      pendingImage = null;
    }
    if (imageAvailable.getAndSet(false)) {
      Image latest = null;
      try {
        latest = reader.acquireLatestImage();
      } catch (IllegalStateException e) {
        Log.w(TAG, "Could not acquire a decoded frame", e);
      }
      if (latest != null) {
        boolean waited = pendingImage != null;
        if (waited) {
          pendingImage.close();
          pendingImage = null;
        }
        if (!waited) {
          // Otherwise waited for since the frame it replaces: frames each replaced before they
          // are written would never be handed out.
          pendingSinceNs = System.nanoTime();
        }
        if (isWritten(latest)) {
          if (image != null) {
            image.close();
          }
          image = latest;
        } else {
          pendingImage = latest;
        }
      }
    }
    if (image == null) {
      return false;
    }
    HardwareBuffer buffer = image.getHardwareBuffer();
    if (buffer == null) {
      image.close();
      return false;
    }
    if (currentImage != null) {
      retainedImages.addLast(currentImage);
      while (retainedImages.size() > RETAINED_IMAGES) {
        retainedImages.removeFirst().close();
      }
    }
    currentImage = new AcquiredImage(image, buffer);
    return true;
  }

  /**
   * A decoder may hand a frame over before it is done writing it, with a fence: it is only
   * reported from Android 13 on. Waits for it, or (see {@link #waitsForFrames}) only tells
   * whether the frame is written. A frame still not written a second after it was handed over is
   * taken as written.
   */
  private boolean isWritten(Image image) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
      return true;
    }
    try (SyncFence fence = image.getFence()) {
      if (!fence.isValid()) {
        return true;
      }
      long elapsedNs = System.nanoTime() - pendingSinceNs;
      long remainingNs = waitsForFrames ? Math.max(0, WRITE_TIMEOUT_NS - elapsedNs) : 0;
      if (fence.await(Duration.ofNanos(remainingNs))) {
        return true;
      }
      if (!waitsForFrames && elapsedNs < WRITE_TIMEOUT_NS) {
        return false;
      }
      Log.w(TAG, "A decoded frame was not written after 1 second");
    } catch (IOException e) {
      Log.w(TAG, "Could not wait for a decoded frame to be written", e);
    }
    return true;
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
   * Closes the acquired frames and frees the reader's free buffers, if it acquired any: while
   * its item is not live. The frames rendered meanwhile stay queued.
   */
  public void releaseFrames() {
    if (currentImage == null && retainedImages.isEmpty() && pendingImage == null) {
      return;
    }
    if (pendingImage != null) {
      pendingImage.close();
      pendingImage = null;
    }
    if (currentImage != null) {
      currentImage.close();
      currentImage = null;
    }
    while (!retainedImages.isEmpty()) {
      retainedImages.removeFirst().close();
    }
    reader.discardFreeBuffers();
  }

  /**
   * Closes the acquired frames and the reader. The decoder must be released first.
   */
  public void release() {
    releaseFrames();
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

  /**
   * Listener called when the decoder rendered a frame.
   */
  public interface OnFrameAvailableListener {
    void onFrameAvailable();
  }
}
