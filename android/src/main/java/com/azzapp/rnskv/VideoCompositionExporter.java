package com.azzapp.rnskv;

import android.graphics.ImageFormat;
import android.hardware.HardwareBuffer;
import android.media.Image;
import android.media.ImageReader;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.Message;
import android.os.Process;
import android.util.Log;

import androidx.annotation.NonNull;

import com.facebook.jni.HybridData;
import com.facebook.jni.annotations.DoNotStrip;

import java.io.IOException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;


/**
 * A class that exports a video composition to a video file.
 */
public class VideoCompositionExporter {

  private static final String TAG = "VideoCompositionExporter";

  @DoNotStrip
  private HybridData mHybridData;

  private final VideoComposition composition;

  private final int frameRate;

  private final VideoCompositionDecoder decoder;

  private final VideoEncoder encoder;

  private int currentFrame = 0;

  private final Map<VideoComposition.Item, Boolean> awaitedItems = new HashMap<>();

  private final HashMap<String, VideoFrame> videoFrames = new HashMap<>();

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
        decoder.prepare();
        encoder.prepare();
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
      updatedItems = decoder.advance(currentTime, currentFrame == 0, true);
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
    for (VideoComposition.Item item : awaitedItems.keySet()) {
      ImageReader imageReader = decoder.getImageReaderForItem(item);
      VideoCompositionDecoder.VideoDimensions dimensions = decoder.getVideoDimensions(item);
      if (imageReader == null || dimensions == null) {
        continue;
      }
      Image image = imageReader.acquireLatestImage();
      if (image == null) {
        continue;
      }
      HardwareBuffer hardwareBuffer = image.getHardwareBuffer();
      image.close();
      if (hardwareBuffer == null) {
        continue;
      }
      String id = item.getId();
      VideoFrame currentVideoFrame = videoFrames.get(id);
      if (currentVideoFrame != null) {
        currentVideoFrame.getBuffer().close();
      }
      videoFrames.put(id, new VideoFrame(
        hardwareBuffer,
        dimensions.width(),
        dimensions.height(),
        dimensions.rotation()
      ));
    }

    renderFrame((double) currentFrame / frameRate, videoFrames);

    long nbFrames = (long) Math.floor(frameRate * composition.getDuration());
    boolean eos = currentFrame == nbFrames - 1;
    encoder.drainEncoder(eos);
    if (!eos) {
      currentFrame += 1;
      decodeNextFrame();
    } else {
      handleComplete();
    }
  }

  public Object getCodecInputSurface() {
    return encoder.getInputSurface();
  }

  /**
   * Renders a frame. (call the javascript render method with a skia canvas on the native side)
   */
  public native void renderFrame(double timeUS, Map<String, VideoFrame> videoFrames);

  private native void onComplete();

  private native void onError(Object e);

}
