package com.azzapp.rnskv;

import android.hardware.HardwareBuffer;

/**
 * A class to represent a video frame.
 */
public class VideoFrame {
  private final HardwareBuffer buffer;
  private final int width;
  private final int height;
  private final int rotation;
  private final long timestampNs;

  public VideoFrame(
    HardwareBuffer buffer,
    int width,
    int height,
    int rotation,
    long timestampNs
  ) {
    this.buffer = buffer;
    this.width = width;
    this.height = height;
    this.rotation = rotation;
    this.timestampNs = timestampNs;
  }

  /**
   * The RGBA hardware buffer holding the frame pixels.
   */
  public HardwareBuffer getBuffer() {
    return buffer;
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
