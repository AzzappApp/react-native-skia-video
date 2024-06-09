package com.azzapp.rnskv;

import android.hardware.HardwareBuffer;
import android.media.Image;

/**
 * A class to represent a video frame.
 */
public class VideoFrame {
  private final HardwareBuffer buffer;
  private final int width;
  private final int height;
  private final int rotation;
  private final long timestamp;
  private Image image;

  /**
   * Creates a new video frame.
   * Returns null if the image is not backed by a HardwareBuffer.
   *
   * @param Image The ImageReader image to create the video frame from.
   * @param rotation The rotation of the video frame.
   */
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
    this.timestamp = image.getTimestamp();
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

  public long getTimestamp() {
    return timestamp;
  }

  public void release() {
    image.close();
    buffer.close();
  }
}
