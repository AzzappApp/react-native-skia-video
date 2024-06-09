package com.azzapp.rnskv;

import android.hardware.HardwareBuffer;
import android.media.Image;

public class VideoFrame {
  private final HardwareBuffer buffer;
  private final int width;
  private final int height;
  private final int rotation;
  private Image image;

  public static VideoFrame create(Image image, int rotation) {
    HardwareBuffer buffer = image.getHardwareBuffer();
    if (buffer == null) {
      return null;
    }
    return new VideoFrame(
      buffer,
      image,
      rotation
    );
  }

  private VideoFrame(
    HardwareBuffer buffer,
    Image image,
    int rotation
  ) {
    this.buffer = buffer;
    this.image = image;
    this.width = image.getWidth();
    this.height = image.getHeight();
    this.rotation = rotation;
  }


  public Object getHardwareBuffer() {
    return buffer.isClosed() ? null : buffer;
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

  public void release() {
    image.close();
    buffer.close();
  }
}
