package com.azzapp.rnskv;

import android.os.Debug;

public class MemoryUsage {

  /**
   * Returns the memory used by the process in bytes: its total proportional
   * set size, which includes the graphics memory (GL / EGL mtrack) that video
   * buffers are allocated from. Slow (tens of milliseconds): meant for
   * benchmarks, not to be called per frame.
   */
  public static long getFootprint() {
    Debug.MemoryInfo memoryInfo = new Debug.MemoryInfo();
    Debug.getMemoryInfo(memoryInfo);
    return memoryInfo.getTotalPss() * 1024L;
  }
}
