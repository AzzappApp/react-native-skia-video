package com.azzapp.rnskv;

import android.os.Handler;
import android.os.HandlerThread;

import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

public class VideoCompositionFramesExtractorSync {
  /**
   * How long preparing the decoders or decoding the frames of a time may take: a decoder that
   * stops producing frames fails the export instead of blocking it for good.
   */
  private static final long TIMEOUT_SECONDS = 30;

  private final VideoComposition composition;

  private final VideoCompositionDecoder decoder;

  private boolean decoding = false;
  private long decodingTimeUs;

  private final Map<VideoComposition.Item, Long> itemsTimes = new HashMap<>();

  private final Set<VideoComposition.Item> itemsEnded = new HashSet<>();

  private final Map<String, Long> renderedTimes = new HashMap<>();

  private HandlerThread exportThread = null;

  private Handler handler;

  private volatile CompletableFuture<Map<String, VideoFrame>> future;

  // A decoder error reported while no frames were being decoded, thrown by the next
  // decodeCompositionFrames. Accessed on the export thread only.
  private Exception pendingError;

  public VideoCompositionFramesExtractorSync(VideoComposition composition) {
    this.composition = composition;
    this.decoder = new VideoCompositionDecoder(composition);
  }

  public void start() throws Exception {
    exportThread = new HandlerThread("ReactNativeSkiaVideo-ExportThread");
    exportThread.start();
    handler = new Handler(exportThread.getLooper());
    CompletableFuture<Void> future = new CompletableFuture<>();
    handler.post(() -> {
      try {
        decoder.prepare();
        decoder.setOnErrorListener(this::handleError);
        decoder.setOnFrameAvailableListener(this::onFrameAvailable);
        decoder.setOnItemEndReachedListener(this::onItemEndReached);
        decoder.setOnItemImageAvailableListener(this::onItemImageAvailable);
        decoder.start();
      } catch (Exception e) {
        future.completeExceptionally(e);
        return;
      }
      future.complete(null);
    });

    await(future, "prepare the decoders");
  }

  private static <T> T await(CompletableFuture<T> future, String what) throws Exception {
    try {
      return future.get(TIMEOUT_SECONDS, TimeUnit.SECONDS);
    } catch (TimeoutException e) {
      future.cancel(true);
      throw new Exception("Could not " + what + " in " + TIMEOUT_SECONDS + " seconds", e);
    }
  }

  /**
   * Decode the next frame of each composition item according to the current position of the player.
   *
   * @return a map of item id to video frame
   */
  public Map<String, VideoFrame> decodeCompositionFrames(double time) throws Exception {
    decodingTimeUs = TimeHelpers.secToUs(time);
    CompletableFuture<Map<String, VideoFrame>> future = new CompletableFuture<>();
    this.future = future;
    handler.post(() -> {
      if (pendingError != null) {
        future.completeExceptionally(pendingError);
        pendingError = null;
        return;
      }
      decoding = true;
      renderedTimes.clear();
      checkIfFrameDecoded();
    });
    return await(future, "decode the frames at " + time + " s");
  }

  public void release() {
    if (future != null) {
      future.cancel(true);
    }
    if (handler != null) {
      // The decoder's EGL context and GL resources are bound to the export
      // thread (where they are current); releasing them from another thread
      // would silently fail the GL deletes and defer the EGL context
      // destruction. Release on the export thread, then let the looper
      // drain and quit.
      handler.post(decoder::release);
      exportThread.quitSafely();
      exportThread = null;
      handler = null;
    } else {
      decoder.release();
      if (exportThread != null) {
        exportThread.quit();
        exportThread = null;
      }
    }
  }

  private void onFrameAvailable(VideoComposition.Item item, long presentationTimeUs) {
    itemsTimes.put(item, presentationTimeUs);
    if (decoding) {
      checkIfFrameDecoded();
    }
  }

  private void onItemEndReached(VideoComposition.Item item) {
    itemsEnded.add(item);
    if (decoding) {
      checkIfFrameDecoded();
    }
  }

  private void checkIfFrameDecoded() {
    boolean allItemsReady = true;
    for (VideoComposition.Item item : composition.getItems()) {
      if (!item.isVideo()) {
        continue;
      }
      // Before the frame times: an item can end before its first frame.
      if (itemsEnded.contains(item)) {
        continue;
      }
      if (!itemsTimes.containsKey(item)) {
        allItemsReady = false;
        continue;
      }
      Long itemTime = itemsTimes.get(item);
      if (itemTime == null) {
        allItemsReady = false;
        continue;
      }
      long itemCurrentTimeUs = itemTime;
      long startTimeUs = TimeHelpers.secToUs(item.getStartTime());
      long compositionStartTimeUs = TimeHelpers.secToUs(item.getCompositionStartTime());
      if (itemCurrentTimeUs - startTimeUs < decodingTimeUs - compositionStartTimeUs) {
        allItemsReady = false;
      }
    }
    Map<String, Long> renderedTimes = decoder.render(decodingTimeUs);
    renderedTimes.forEach((itemId, time) -> {
      if (time != null) {
        this.renderedTimes.put(itemId, time);
      }
    });
    if (allItemsReady) {
      decoding = false;
      resolveIfReady();
    }
  }

  private void onItemImageAvailable(VideoComposition.Item item) {
    if (!decoding) {
      resolveIfReady();
    }
  }

  private void handleError(Exception e) {
    CompletableFuture<Map<String, VideoFrame>> future = this.future;
    if (future == null || future.isDone()) {
      // No frames are being decoded: thrown by the next decodeCompositionFrames.
      if (pendingError == null) {
        pendingError = e;
      }
      return;
    }
    future.completeExceptionally(e);
  }

  private void resolveIfReady() {
    CompletableFuture<Map<String, VideoFrame>> future = this.future;
    // An image can be available before the first decodeCompositionFrames.
    if (future == null) {
      return;
    }
    Map<String, VideoFrame> videoFrames = decoder.updateVideosFrames();
    for (VideoComposition.Item item : composition.getItems()) {
      if (!item.isVideo()) {
        continue;
      }
      VideoFrame videoFrame = videoFrames.getOrDefault(item.getId(), null);
      if (videoFrame == null) {
        // An item that ended without a frame has none to wait for.
        if (itemsEnded.contains(item)) {
          continue;
        }
        return;
      }
      Long itemFrameTime = renderedTimes.getOrDefault(item.getId(), null);
      if (itemFrameTime == null) {
        continue;
      }
      long videoFrameTime = TimeHelpers.nsecToUs(videoFrame.getTimestampNs());
      if (Math.abs(itemFrameTime - videoFrameTime) > 1000) {
        return;
      }
    }
    future.complete(videoFrames);
  }
}
