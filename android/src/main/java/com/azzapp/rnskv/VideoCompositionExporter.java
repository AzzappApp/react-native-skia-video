package com.azzapp.rnskv;

import android.os.Handler;
import android.os.HandlerThread;
import android.util.Log;

import com.facebook.jni.HybridData;
import com.facebook.jni.annotations.DoNotStrip;

import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

import javax.microedition.khronos.egl.EGL10;
import javax.microedition.khronos.egl.EGLContext;


/**
 * A class that exports a video composition to a video file.
 */
public class VideoCompositionExporter {

  @DoNotStrip
  private HybridData mHybridData;

  private final VideoComposition composition;

  private final int frameRate;

  private final VideoCompositionDecoder decoder;

  private final VideoEncoder encoder;

  private int currentFrame = 0;

  public boolean decoding = true;

  private final Map<VideoComposition.Item, Long> itemsTimes = new HashMap<>();

  private final Set<VideoComposition.Item> itemsEnded = new HashSet<>();

  private final Map<String, Long> renderedTimes = new HashMap<>();

  private HandlerThread exportThread = null;

  private Handler handler;

  /**
   * Creates a new video composition exporter.
   *
   * @param data        The hybrid data.
   * @param composition The video composition to export.
   * @param outPath     The path to the output video file.
   * @param width       The width of the output video.
   * @param height      The height of the output video.
   * @param frameRate   The frame rate of the output video.
   * @param bitRate     The bit rate of the output video.
   */
  public VideoCompositionExporter(
    HybridData data,
    VideoComposition composition,
    String outPath,
    int width,
    int height,
    int frameRate,
    int bitRate
  ) {
    mHybridData = data;
    this.composition = composition;
    this.frameRate = frameRate;

    decoder = new VideoCompositionDecoder(composition);
    encoder = new VideoEncoder(outPath, width, height, frameRate, bitRate);
  }

  private void handleComplete() {
    release();
    onComplete();
  }

  private void handleError(Exception e) {
    Log.e("ReactNativeSkiaVideo", "Error while exporting", e);
    release();
    onError(e);
  }

  private void release() {
    encoder.release();
    decoder.release();
    if (exportThread != null) {
      exportThread.quit();
    }
  }

  /**
   * Starts the export process.
   */
  public void start() {
    exportThread = new HandlerThread("ReactNativeSkiaVideo-ExportThread");
    exportThread.start();
    handler = new Handler(exportThread.getLooper());
    handler.post(() -> {
      try {
        makeSkiaSharedContextCurrent();
        EGLContext sharedContext = ((EGL10) EGLContext.getEGL()).eglGetCurrentContext();
        if (sharedContext == EGL10.EGL_NO_CONTEXT) {
          throw new RuntimeException("No shared context");
        }
        encoder.prepare(sharedContext);
        decoder.prepare();
        decoder.setOnErrorListener(this::handleError);
        decoder.setOnFrameAvailableListener(this::onFrameAvailable);
        decoder.setOnItemEndReachedListener(this::onItemEndReached);
        decoder.setOnItemImageAvailableListener(this::onItemImageAvailable);
        decoder.start();
        checkIfFrameDecoded();
      } catch (Exception e) {
        handleError(e);
        return;
      }
    });
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
    long currentTimeUs = TimeHelpers.secToUs((double) currentFrame / frameRate);
    boolean allItemsReady = true;
    for (VideoComposition.Item item : composition.getItems()) {
      if (!itemsTimes.containsKey(item)) {
        allItemsReady = false;
        continue;
      }
      if (itemsEnded.contains(item)) {
        continue;
      }
      long itemCurrentTimeUs = itemsTimes.get(item);
      long startTimeUs = TimeHelpers.secToUs(item.getStartTime());
      long compositionStartTimeUs = TimeHelpers.secToUs(item.getCompositionStartTime());
      if (itemCurrentTimeUs - startTimeUs < currentTimeUs - compositionStartTimeUs) {
        itemsTimes.get(itemCurrentTimeUs);
        allItemsReady = false;
      }
    }
    Map<String, Long> renderedTimes = decoder.render(currentTimeUs);
    renderedTimes.forEach((itemId, time) -> {
      if (time != null) {
        this.renderedTimes.put(itemId, time);
      }
    });
    if (allItemsReady) {
      decoding = false;
      writeFrameIfReady();
    }
  }

  private void onItemImageAvailable(VideoComposition.Item item) {
    if (!decoding) {
      writeFrameIfReady();
    }
  }

  private void writeFrameIfReady() {
    Map<String, VideoFrame> videoFrames = decoder.getUpdatedVideoFrames();
    for (VideoComposition.Item item : composition.getItems()) {
      VideoFrame videoFrame = videoFrames.getOrDefault(item.getId(), null);
      if (videoFrame == null) {
        return;
      }
      Long itemFrameTime = renderedTimes.getOrDefault(item.getId(), null);
      if (itemFrameTime == null) {
        continue;
      }
      long videoFrameTime = TimeHelpers.nsecToUs(videoFrame.getTimestamp());
      if (Math.abs(itemFrameTime - videoFrameTime) > 1000) {
        return;
      }
    }
    writeFrame();
  }

  private void writeFrame() {
    long nbFrames = (long) Math.floor(frameRate * composition.getDuration());
    boolean eos = currentFrame == nbFrames - 1;
    double time = (double) currentFrame / frameRate;
    int texture = renderFrame(time, decoder.getUpdatedVideoFrames());
    encoder.writeFrame(TimeHelpers.secToUs(time), texture, eos);
    if (!eos) {
      currentFrame += 1;
      decoding = true;
      renderedTimes.clear();
      checkIfFrameDecoded();
    } else {
      handleComplete();
    }
  }

  /**
   * Makes the Skia shared context current.
   */
  private native void makeSkiaSharedContextCurrent();

  /**
   * Renders a frame. (call the javascript render method with a skia canvas on the native side)
   */
  public native int renderFrame(double timeSecond, Map<String, VideoFrame> videoFrames);

  private native void onComplete();

  private native void onError(Object e);

}
