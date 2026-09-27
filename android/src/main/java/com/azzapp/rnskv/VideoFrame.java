package com.azzapp.rnskv;

/**
 * A class to represent a video frame.
 */
public class VideoFrame {
  /** GL_TEXTURE_2D: a copy the decoder owns, upright and at the item's size. */
  public static final int TARGET_2D = 0x0DE1;

  /**
   * GL_TEXTURE_EXTERNAL_OES: the decoder's own buffer, as decoded. It can be
   * larger than the picture, which is its crop, and is shown rotated by the
   * frame's rotation.
   */
  public static final int TARGET_EXTERNAL = 0x8D65;

  private int texture;
  private final int target;
  private final int width;
  private final int height;
  private final int rotation;
  private final long timestampNs;
  private final int cropX;
  private final int cropY;
  private final int cropWidth;
  private final int cropHeight;

  public VideoFrame(
    int texture,
    int width,
    int height,
    int rotation,
    long timestampNs
  ) {
    this(texture, TARGET_2D, width, height, rotation, timestampNs, 0, 0, width, height);
  }

  public VideoFrame(
    int texture,
    int target,
    int width,
    int height,
    int rotation,
    long timestampNs,
    int cropX,
    int cropY,
    int cropWidth,
    int cropHeight
  ) {
    this.texture = texture;
    this.target = target;
    this.width = width;
    this.height = height;
    this.rotation = rotation;
    this.timestampNs = timestampNs;
    this.cropX = cropX;
    this.cropY = cropY;
    this.cropWidth = cropWidth;
    this.cropHeight = cropHeight;
  }

  public int getTexture() {
    return texture;
  }

  public int getTarget() {
    return target;
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

  public int getCropX() {
    return cropX;
  }

  public int getCropY() {
    return cropY;
  }

  public int getCropWidth() {
    return cropWidth;
  }

  public int getCropHeight() {
    return cropHeight;
  }
}
