package com.azzapp.rnskv;

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
}
