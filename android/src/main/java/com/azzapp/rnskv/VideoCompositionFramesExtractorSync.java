package com.azzapp.rnskv;

import android.os.Handler;
import android.os.HandlerThread;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CompletableFuture;

public class VideoCompositionFramesExtractorSync {
  private final VideoComposition composition;

  private final VideoCompositionDecoder decoder;

  private boolean decoding = false;
  private long decodingTimeUs;

  private final Map<VideoComposition.Item, Long> itemsTimes = new HashMap<>();

  private final Set<VideoComposition.Item> itemsEnded = new HashSet<>();

  private final Map<String, Long> renderedTimes = new HashMap<>();

  private HandlerThread exportThread = null;

  private Handler handler;

  private CompletableFuture<Map<String, VideoFrame>> future;

  private ExportDiagnostics diagnostics;

  public VideoCompositionFramesExtractorSync(VideoComposition composition) {
    this.composition = composition;
    this.decoder = new VideoCompositionDecoder(composition, false);
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
        if (ExportDiagnostics.ENABLED) {
          List<String> itemIds = new ArrayList<>();
          for (VideoComposition.Item item : composition.getItems()) {
            if (item.isVideo()) {
              itemIds.add(item.getId());
            }
          }
          diagnostics = new ExportDiagnostics(itemIds, decoder.usesYUVFrames());
        }
      } catch (Exception e) {
        future.completeExceptionally(e);
        return;
      }
      future.complete(null);
    });

    future.get();
  }

  /**
   * Decode the next frame of each composition item according to the current position of the player.
   *
   * @return a map of item id to video frame
   */
  public Map<String, VideoFrame> decodeCompositionFrames(double time) throws Exception {
    decodingTimeUs = TimeHelpers.secToUs(time);
    future = new CompletableFuture<>();
    if (diagnostics != null) {
      diagnostics.onRequest();
    }
    handler.post(() -> {
      decoding = true;
      renderedTimes.clear();
      if (diagnostics != null) {
        diagnostics.onStart();
        for (VideoComposition.Item item : composition.getItems()) {
          if (item.isVideo()) {
            diagnostics.onItemState(
              item.getId(), isItemReady(item), decoder.getPendingFramesCount(item));
          }
        }
      }
      checkIfFrameDecoded();
    });
    return future.get();
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
      if (item.isVideo() && !isItemReady(item)) {
        allItemsReady = false;
      }
    }
    Map<String, Long> renderedTimes = decoder.render(decodingTimeUs);
    renderedTimes.forEach((itemId, time) -> {
      if (time != null) {
        this.renderedTimes.put(itemId, time);
        if (diagnostics != null) {
          diagnostics.onRendered(itemId);
        }
      }
    });
    if (allItemsReady) {
      decoding = false;
      if (diagnostics != null) {
        diagnostics.onReady();
      }
      resolveIfReady();
    }
  }

  /**
   * @return whether the decoder of the item decoded the frame of the
   * requested time
   */
  private boolean isItemReady(VideoComposition.Item item) {
    if (!itemsTimes.containsKey(item)) {
      return false;
    }
    if (itemsEnded.contains(item)) {
      return true;
    }
    Long itemTime = itemsTimes.get(item);
    if (itemTime == null) {
      return false;
    }
    long startTimeUs = TimeHelpers.secToUs(item.getStartTime());
    long compositionStartTimeUs = TimeHelpers.secToUs(item.getCompositionStartTime());
    return itemTime - startTimeUs >= decodingTimeUs - compositionStartTimeUs;
  }

  private void onItemImageAvailable(VideoComposition.Item item) {
    if (!decoding) {
      resolveIfReady();
    }
  }

  private void handleError(Exception e) {
    future.completeExceptionally(e);
  }

  private void resolveIfReady() {
    Map<String, VideoFrame> videoFrames = decoder.updateVideosFrames();
    if (diagnostics != null) {
      videoFrames.forEach((itemId, videoFrame) -> {
        Long itemFrameTime = renderedTimes.get(itemId);
        if (itemFrameTime != null
          && Math.abs(itemFrameTime - TimeHelpers.nsecToUs(videoFrame.getTimestampNs())) <= 1000) {
          diagnostics.onAcquired(itemId);
        }
      });
    }
    for (VideoComposition.Item item : composition.getItems()) {
      if (!item.isVideo()) {
        continue;
      }
      VideoFrame videoFrame = videoFrames.getOrDefault(item.getId(), null);
      if (videoFrame == null) {
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
    if (diagnostics != null && !future.isDone()) {
      diagnostics.onResolved(decoder.takeAcquireNs());
    }
    future.complete(videoFrames);
  }
}
