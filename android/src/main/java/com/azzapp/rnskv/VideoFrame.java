package com.sheunglaili.rnskv;

/**
 * A class to represent a video frame.
 */
public class VideoFrame {
  private int texture;
  private final int width;
  private final int height;
  private final int rotation;
  private final long timestampNs;

  public VideoFrame(
    int texture,
    int width,
    int height,
    int rotation,
    long timestampNs
  ) {
    this.texture = texture;
    this.width = width;
    this.height = height;
    this.rotation = rotation;
    this.timestampNs = timestampNs;
  }

  public int getTexture() {
    return texture;
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
