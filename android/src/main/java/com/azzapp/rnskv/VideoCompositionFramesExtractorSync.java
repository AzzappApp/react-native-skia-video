package com.azzapp.rnskv;

import android.os.Handler;
import android.os.HandlerThread;

import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CompletableFuture;

import javax.microedition.khronos.egl.EGLContext;

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

  public VideoCompositionFramesExtractorSync(VideoComposition composition) {
    this.composition = composition;
    this.decoder = new VideoCompositionDecoder(composition);
  }

  public void start() throws Exception {
    exportThread = new HandlerThread("ReactNativeSkiaVideo-ExportThread");
    exportThread.start();
    handler = new Handler(exportThread.getLooper());
    CompletableFuture<Void> future = new CompletableFuture<>();
    EGLContext sharedContext = EGLUtils.getCurrentContextOrThrows();
    handler.post(() -> {
      try {
        decoder.prepare(sharedContext);
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
    handler.post(() -> {
      decoding = true;
      renderedTimes.clear();
      checkIfFrameDecoded();
    });
    return future.get();
  }

  public void release() {
    decoder.release();
    if (exportThread != null) {
      exportThread.quit();
    }
    if (future != null) {
      future.cancel(true);
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
      if (!itemsTimes.containsKey(item)) {
        allItemsReady = false;
        continue;
      }
      if (itemsEnded.contains(item)) {
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
    future.completeExceptionally(e);
  }

  private void resolveIfReady() {
    Map<String, VideoFrame> videoFrames = decoder.updateVideosFrames();
    for (VideoComposition.Item item : composition.getItems()) {
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
    future.complete(videoFrames);
  }
}
