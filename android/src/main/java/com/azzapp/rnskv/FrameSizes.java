package com.azzapp.rnskv;

import android.util.Size;

public class FrameSizes {
  /**
   * The size frames are scaled down to for their long side not to exceed {@code maxLongSide},
   * keeping their aspect ratio. Frames that already fit, or without a cap
   * ({@code maxLongSide <= 0}), keep their size.
   *
   * The long side does not depend on the orientation: the size may be the stored one or the
   * rotated one. A caller capping the size itself would have to pass encoded dimensions, the ones
   * it cannot know, since every API hands it display dimensions. Asking it for the long side
   * leaves nothing to get wrong.
   */
  public static Size capLongSide(int width, int height, double maxLongSide) {
    int longSide = Math.max(width, height);
    if (maxLongSide <= 0 || longSide <= maxLongSide) {
      return new Size(width, height);
    }
    // Even sizes: the frames are 4:2:0, their chroma planes half the size.
    double scale = maxLongSide / longSide;
    return new Size(
      Math.max(2, 2 * (int) Math.round(width * scale / 2)),
      Math.max(2, 2 * (int) Math.round(height * scale / 2)));
  }
}
