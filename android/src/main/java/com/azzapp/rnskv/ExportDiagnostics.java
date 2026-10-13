package com.azzapp.rnskv;

import android.util.Log;

import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Debug builds: measures where an export waits for the frames of its decoders
 * ({@link VideoCompositionFramesExtractorSync}), and logs a summary every
 * {@link #FRAMES_PER_REPORT} frames: {@code adb logcat -s RNSkiaVideoExport}.
 */
final class ExportDiagnostics {

  static final String TAG = "RNSkiaVideoExport";

  static final boolean ENABLED = BuildConfig.DEBUG;

  private static final int FRAMES_PER_REPORT = 30;

  static void log(String message) {
    if (ENABLED) {
      Log.d(TAG, message);
    }
  }

  private final Map<String, Integer> itemIndexes = new HashMap<>();

  private final int nbItems;

  private final boolean yuvFrames;

  private int frameIndex = 0;

  // The current frame (System.nanoTime).
  private long requestNs;
  private long startNs;
  private long readyNs;
  private final long[] renderNs;
  private final long[] acquiredNs;

  // Totals of the frames of the current report.
  private int frames = 0;
  private double queueMs;
  private double waitDecodersMs;
  private double afterReadyMs;
  private double totalMs;
  private double acquireMs;
  private final int[] decodedAhead;
  private final int[] pendingFrames;
  private final double[] renderToAcquiredMs;
  private final int[] renderToAcquiredCount;

  ExportDiagnostics(List<String> itemIds, boolean yuvFrames) {
    for (String itemId : itemIds) {
      itemIndexes.put(itemId, itemIndexes.size());
    }
    nbItems = itemIds.size();
    this.yuvFrames = yuvFrames;
    renderNs = new long[nbItems];
    acquiredNs = new long[nbItems];
    decodedAhead = new int[nbItems];
    pendingFrames = new int[nbItems];
    renderToAcquiredMs = new double[nbItems];
    renderToAcquiredCount = new int[nbItems];
  }

  /** JS asks for the frames of the next time (on the JS thread). */
  void onRequest() {
    requestNs = System.nanoTime();
  }

  /** The export thread starts looking for the frames. */
  void onStart() {
    startNs = System.nanoTime();
    readyNs = 0;
    for (int i = 0; i < nbItems; i++) {
      renderNs[i] = 0;
      acquiredNs[i] = 0;
    }
  }

  /**
   * @param ahead   whether the decoder had already decoded the requested
   *                frame when it was requested
   * @param pending the frames the decoder had decoded and not rendered yet
   */
  void onItemState(String itemId, boolean ahead, int pending) {
    Integer index = itemIndexes.get(itemId);
    if (index == null) {
      return;
    }
    if (ahead) {
      decodedAhead[index]++;
    }
    pendingFrames[index] += pending;
  }

  /** Every decoder decoded the requested frame. */
  void onReady() {
    if (readyNs == 0) {
      readyNs = System.nanoTime();
    }
  }

  /** The decoder of the item released the requested frame to its surface. */
  void onRendered(String itemId) {
    Integer index = itemIndexes.get(itemId);
    if (index != null && renderNs[index] == 0) {
      renderNs[index] = System.nanoTime();
    }
  }

  /** The frame of the item reached the frame extractor. */
  void onAcquired(String itemId) {
    Integer index = itemIndexes.get(itemId);
    if (index != null && acquiredNs[index] == 0) {
      acquiredNs[index] = System.nanoTime();
    }
  }

  /**
   * The frames are handed to JS.
   *
   * @param acquireNs the time spent getting the frames from the frame
   *                  extractors (fence waits, OpenGL draws)
   */
  void onResolved(long acquireNs) {
    long doneNs = System.nanoTime();
    long ready = readyNs != 0 ? readyNs : doneNs;
    queueMs += toMs(startNs - requestNs);
    waitDecodersMs += toMs(ready - startNs);
    afterReadyMs += toMs(doneNs - ready);
    totalMs += toMs(doneNs - requestNs);
    acquireMs += toMs(acquireNs);
    for (int i = 0; i < nbItems; i++) {
      if (renderNs[i] != 0 && acquiredNs[i] != 0) {
        renderToAcquiredMs[i] += toMs(acquiredNs[i] - renderNs[i]);
        renderToAcquiredCount[i]++;
      }
    }
    frames++;
    frameIndex++;
    if (frames == FRAMES_PER_REPORT) {
      report();
    }
  }

  private void report() {
    Log.d(TAG, String.format(Locale.US,
      "frames %d-%d, %d clip(s), %s: native %.1f ms/frame (queue %.1f, waiting for the decoders %.1f, after ready %.1f, of which getting the frames %.1f)",
      frameIndex - frames, frameIndex - 1, nbItems, yuvFrames ? "YUV" : "OpenGL",
      totalMs / frames, queueMs / frames, waitDecodersMs / frames,
      afterReadyMs / frames, acquireMs / frames));
    for (int i = 0; i < nbItems; i++) {
      Log.d(TAG, String.format(Locale.US,
        "  clip %d: decoded ahead %d%% of the frames, %.1f decoded frames pending, render to frame %.1f ms",
        i, decodedAhead[i] * 100 / frames, (double) pendingFrames[i] / frames,
        renderToAcquiredCount[i] > 0 ? renderToAcquiredMs[i] / renderToAcquiredCount[i] : 0));
    }
    frames = 0;
    queueMs = waitDecodersMs = afterReadyMs = totalMs = acquireMs = 0;
    for (int i = 0; i < nbItems; i++) {
      decodedAhead[i] = 0;
      pendingFrames[i] = 0;
      renderToAcquiredMs[i] = 0;
      renderToAcquiredCount[i] = 0;
    }
  }

  private static double toMs(long ns) {
    return ns / 1e6;
  }
}
