package com.azzapp.rnskv;

import android.hardware.HardwareBuffer;

/**
 * A class to represent a video frame.
 */
public class VideoFrame {
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
