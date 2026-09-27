package com.azzapp.rnskv;

/**
 * The size an item's frames are drawn out at, in display orientation.
 * Pure arithmetic, apart from the GL work that uses it.
 */
final class FrameSize {

  private FrameSize() {
  }

  /**
   * @param width       an explicit width in the file's encoded orientation, or 0
   * @param height      an explicit height in the file's encoded orientation, or 0
   * @param maxLongSide a cap on the longest side, or 0; ignored when a size is
   *                    given, and never upscales
   * @param videoWidth  the decoder's encoded width
   * @param videoHeight the decoder's encoded height
   * @param rotation    the file's rotation in degrees
   * @return {width, height}, swapped for a file turned by 90 or 270 degrees
   */
  static int[] of(
    int width,
    int height,
    int maxLongSide,
    int videoWidth,
    int videoHeight,
    int rotation
  ) {
    int w = videoWidth;
    int h = videoHeight;
    if (width > 0 && height > 0) {
      w = width;
      h = height;
    } else if (maxLongSide > 0 && Math.max(w, h) > maxLongSide) {
      double scale = (double) maxLongSide / Math.max(w, h);
      // Even, as on iOS: hardware scalers dislike odd sizes.
      w = even(w * scale);
      h = even(h * scale);
    }
    if (rotation == 90 || rotation == 270) {
      return new int[]{h, w};
    }
    return new int[]{w, h};
  }

  private static int even(double value) {
    return Math.max(2, (int) Math.round(value / 2) * 2);
  }
}
