package com.azzapp.rnskv;

import android.hardware.HardwareBuffer;

public class VideoFrame {
  private final HardwareBuffer buffer;
  private final int width;
  private final int height;
  private final int rotation;
  private long presentationTimeUS;
  public VideoFrame(
    HardwareBuffer buffer,
    int width,
    int height,
    int rotation
  ) {
    this.buffer = buffer;
    this.width = width;
    this.height = height;
    this.rotation = rotation;
  }

  public Object getHardwareBuffer() {
    return buffer;
  }

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
}
