package com.azzapp.rnskv;

import android.os.Handler;
import android.os.HandlerThread;

import com.facebook.jni.HybridData;
import com.facebook.jni.annotations.DoNotStrip;

import java.util.HashMap;
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

  private final Map<VideoComposition.Item, Boolean> awaitedItems = new HashMap<>();

  private HandlerThread exportThread = null;

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
    Handler handler = new Handler(exportThread.getLooper());
    handler.post(() -> {
      try {
        makeSkiaSharedContextCurrent();
        EGLContext sharedContext = ((EGL10) EGLContext.getEGL()).eglGetCurrentContext();
        if (sharedContext == EGL10.EGL_NO_CONTEXT) {
          throw new RuntimeException("No shared context");
        }
        encoder.prepare(sharedContext);
        decoder.prepare();
        decoder.setOnItemImageAvailableListener(this::imageAvailable);
      } catch (Exception e) {
        handleError(e);
        return;
      }
      decodeNextFrame();
    });
  }

  private void decodeNextFrame() {
    long currentTime = TimeHelpers.secToUs((double) currentFrame / frameRate);
    Set<VideoComposition.Item> updatedItems;
    try {
      updatedItems = decoder.advance(currentTime, currentFrame == 0);
    } catch (Exception e) {
      handleError(e);
      return;
    }
    if (updatedItems.size() == 0) {
      writeFrame();
    } else {
      for (VideoComposition.Item item : updatedItems) {
        awaitedItems.put(item, true);
      }
    }
  }

  private void imageAvailable(VideoComposition.Item item) {
    awaitedItems.put(item, false);
    for (Boolean waiting : awaitedItems.values()) {
      if (waiting) {
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
      decodeNextFrame();
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
