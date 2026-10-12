package com.azzapp.rnskv;

import android.graphics.Rect;
import android.hardware.HardwareBuffer;

import java.util.concurrent.atomic.AtomicLong;

/**
 * A class to represent a video frame.
 */
public class VideoFrame {
  private static final AtomicLong NEXT_ID = new AtomicLong(1);

  private final long id = NEXT_ID.getAndIncrement();
  private final HardwareBuffer hardwareBuffer;
  private final int width;
  private final int height;
  private final int rotation;
  private final long timestampNs;
  private final boolean yuv;
  private final Rect cropRect;
  private final int sourceRotation;

  /**
   * A frame rendered into an RGBA buffer, ready to be copied (see
   * {@link GLFrameExtractor}).
   */
  public VideoFrame(
    HardwareBuffer hardwareBuffer,
    int width,
    int height,
    int rotation,
    long timestampNs
  ) {
    this.hardwareBuffer = hardwareBuffer;
    this.width = width;
    this.height = height;
    this.rotation = rotation;
    this.timestampNs = timestampNs;
    this.yuv = false;
    this.cropRect = new Rect(0, 0, width, height);
    this.sourceRotation = 0;
  }

  /**
   * A frame in a buffer of the decoder, in its own YUV layout (see
   * {@link ImageReaderFrameExtractor}): JS converts the region `cropRect` of
   * the buffer to RGB, rotates it clockwise by `sourceRotation` and scales it
   * to width × height.
   */
  public VideoFrame(
    HardwareBuffer hardwareBuffer,
    int width,
    int height,
    long timestampNs,
    Rect cropRect,
    int sourceRotation
  ) {
    this.hardwareBuffer = hardwareBuffer;
    this.width = width;
    this.height = height;
    this.rotation = 0;
    this.timestampNs = timestampNs;
    this.yuv = true;
    this.cropRect = cropRect;
    this.sourceRotation = sourceRotation;
  }

  /**
   * @return an id unique to the frame. The composition decoders hand out
   * their current frame again until a new one is decoded: JS copies a frame
   * to the GPU once, and recognizes it by its id.
   */
  public long getId() {
    return id;
  }

  /**
   * @return the hardware buffer holding the pixels of the frame
   */
  public HardwareBuffer getHardwareBuffer() {
    return hardwareBuffer;
  }

  public int getWidth() {
    return width;
  }

  public int getHeight() {
    return height;
  }

  public int getRotation() {
    return rotation;
  }

  public long getTimestampNs() {
    return timestampNs;
  }

  public boolean isYUV() {
    return yuv;
  }

  public int getCropLeft() {
    return cropRect.left;
  }

  public int getCropTop() {
    return cropRect.top;
  }

  public int getCropWidth() {
    return cropRect.width();
  }

  public int getCropHeight() {
    return cropRect.height();
  }

  public int getSourceRotation() {
    return sourceRotation;
  }
}
