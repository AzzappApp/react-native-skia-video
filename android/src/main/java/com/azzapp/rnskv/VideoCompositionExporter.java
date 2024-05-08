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
import java.util.Map;


/**
 * A class that exports a video composition to a video file.
 */
public class VideoCompositionExporter {

  private static final String TAG = "VideoCompositionExporter";

  @DoNotStrip
  private HybridData mHybridData;

  private final VideoComposition composition;

  private final int frameRate;

  private final VideoEncoder encoder;

  private final ExportThread exportThead;

  /**
   * Creates a new video composition exporter.
   * @param data The hybrid data.
   * @param composition The video composition to export.
   * @param outPath The path to the output video file.
   * @param width The width of the output video.
   * @param height The height of the output video.
   * @param frameRate The frame rate of the output video.
   * @param bitRate The bit rate of the output video.
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
    encoder = new VideoEncoder(outPath, width, height, frameRate, bitRate);
    exportThead = new ExportThread(
      this::handleComplete,
      this::handleError
    );
  }

  private void handleComplete() {
    clean();
    onComplete();
  }

  private void handleError(Exception e) {
    clean();
    onError(e);
  }

  private void clean() {
    exportThead.release();
    exportThead.quitSafely();
  }

  /**
   * Starts the export process.
   */
  public void start() {
    exportThead.start();
    exportThead.handler.sendEmptyMessage(ExportThread.PREPARE);
  }


  public Object getCodecInputSurface() {
    return encoder.getInputSurface();
  }

  /**
   * Renders a frame. (call the javascript render method with a skia canvas on the native side)
   */
  public native void renderFrame(long timeUS, Map<String, VideoFrame> videoFrames);

  private native void onComplete();

  private native void onError(Object e);
  private class ExportThread extends HandlerThread implements Handler.Callback {

    private static final int PREPARE = 1;

    private static final int FRAME_AVAILABLE = 2;
    private static final int DECODE_NEXT_VIDEOS_FRAME = 3;

    private Boolean releasing = false;

    private Handler handler;

    private final OnCompleteListener completeListener;

    private final OnErrorListener errorListener;

    private HashMap<VideoComposition.Item, VideoCompositionItemDecoder> decoders;

    private HashMap<VideoComposition.Item, ImageReader> imageReaders;

    private final HashMap<VideoComposition.Item, ArrayList<VideoCompositionItemDecoder.Frame>> pendingFrames
      = new HashMap<>();


    private final HashMap<String, VideoFrame> videoFrames = new HashMap<>();

    private final HashMap<VideoComposition.Item, Boolean> itemsAwaited = new HashMap<>();

    private int currentFrame = 0;

    public ExportThread(OnCompleteListener completeListener, OnErrorListener errorListener) {
      super("RNSkiaVideo-ExportThread", Process.THREAD_PRIORITY_BACKGROUND);
      this.completeListener = completeListener;
      this.errorListener = errorListener;
    }

    @Override
    public synchronized void start() {
      super.start();
      handler = new Handler(this.getLooper(), this);
    }

    @Override
    public boolean handleMessage(@NonNull Message msg) {
      if(releasing) {
        return true;
      }

      try {
        switch (msg.what) {
          case PREPARE:
            prepare();
            decodeNextFrame(true);
            return true;
          case FRAME_AVAILABLE:
            onFrameAvailable((VideoComposition.Item) msg.obj);
            return true;
          case DECODE_NEXT_VIDEOS_FRAME:
            decodeNextFrame(false);
            return true;
          default:
            Log.d(TAG, "unknown/invalid message");
            return false;
        }
      } catch (Exception e) {
        errorListener.onError(e);
      }
      return true;
    }

    private void decodeNextFrame(boolean isFirstFrame) {
      long timeUS = currentFrame * 1000000L / frameRate;

      for (VideoComposition.Item item : composition.getItems()) {
        VideoCompositionItemDecoder itemDecoder = decoders.get(item);
        long compositionStartTime = Math.round(item.getCompositionStartTime() * 1000000);
        long endTime = compositionStartTime + Math.round(item.getDuration() * 1000000);

        if (itemDecoder == null || itemDecoder.isOutputEOS() ) {
          continue;
        }
        if (isFirstFrame) {
          while (true) {
            if (itemDecoder.isOutputEOS()) {
              break;
            }
            if (itemDecoder.queueSampleToCodec()) {
              VideoCompositionItemDecoder.Frame frame = itemDecoder.dequeueOutputBuffer();
              if (frame != null) {
                ArrayList<VideoCompositionItemDecoder.Frame> itemPendingFrames =
                  pendingFrames.computeIfAbsent(item, k -> new ArrayList<>());
                itemPendingFrames.add(frame);
                break;
              }
            }
          }
        } else if (compositionStartTime <= timeUS && timeUS < endTime) {
          while (true) {
            if (itemDecoder.getInputSamplePresentationTimeUS() > timeUS - compositionStartTime) {
              break;
            }
            boolean queued = itemDecoder.queueSampleToCodec();
            if (!queued) {
              break;
            }
          }

          while (true) {
            VideoCompositionItemDecoder.Frame frame = itemDecoder.dequeueOutputBuffer();
            if (frame == null) {
              break;
            }
            ArrayList<VideoCompositionItemDecoder.Frame> itemPendingFrames =
              pendingFrames.computeIfAbsent(item, k -> new ArrayList<>());
            itemPendingFrames.add(frame);
          }
        }
      }
      itemsAwaited.clear();
      Map<VideoComposition.Item, ArrayList<VideoCompositionItemDecoder.Frame>> itemFramesToRender
        = new HashMap<>();
      for (Map.Entry<VideoComposition.Item, ArrayList<VideoCompositionItemDecoder.Frame>> entry : pendingFrames.entrySet()) {
        VideoComposition.Item item = entry.getKey();
        long startTime = Math.round(item.getCompositionStartTime() * 1000000);
        ArrayList<VideoCompositionItemDecoder.Frame> framesToRender = new ArrayList<>();
        ArrayList<VideoCompositionItemDecoder.Frame> itemFrames = entry.getValue();
        boolean force = isFirstFrame;
        for (VideoCompositionItemDecoder.Frame frame : itemFrames)  {
          long presentationTime = frame.getPresentationTimeUs();
          if (force || presentationTime <= timeUS - startTime) {
            framesToRender.add(frame);
            force = false;
          }
        }
        if (framesToRender.size() > 0) {
          itemFramesToRender.put(item, framesToRender);
          itemFrames.removeAll(framesToRender);
          itemsAwaited.put(item, true);
        }
      }

      if (itemFramesToRender.size() == 0) {
        onFramesDecoded();
      } else {
        for (ArrayList<VideoCompositionItemDecoder.Frame> frames : itemFramesToRender.values()) {
          int size = frames.size();
          for (int i = 0; i < size; i++) {
            VideoCompositionItemDecoder.Frame frame = frames.get(i);
            if (i == size - 1) {
              frame.render();
            } else {
              frame.release();
            }
          }
        }
      }
    }

    public void prepare() throws IOException {
      decoders = new HashMap<>();
      imageReaders = new HashMap<>();
      for (VideoComposition.Item item : composition.getItems()) {
        VideoCompositionItemDecoder decoder = new VideoCompositionItemDecoder(item);
        decoder.prepare();
        decoders.put(item, decoder);
        ImageReader imageReader;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
          imageReader = ImageReader.newInstance(
            decoder.getVideoWidth(),
            decoder.getVideoHeight(),
            ImageFormat.PRIVATE, 2,
            HardwareBuffer.USAGE_GPU_SAMPLED_IMAGE
          );
        } else {
          imageReader = ImageReader.newInstance(
            decoder.getVideoWidth(), decoder.getVideoHeight(), ImageFormat.PRIVATE, 2);
        }
        imageReader.setOnImageAvailableListener((reader) -> {
          handler.obtainMessage(FRAME_AVAILABLE, item).sendToTarget();
        }, handler);
        decoder.setSurface(imageReader.getSurface());
        imageReaders.put(item, imageReader);
      };
      encoder.prepare();
    }

    synchronized private void onFrameAvailable(VideoComposition.Item item) {
      itemsAwaited.put(item, false);
      for (Boolean waiting: itemsAwaited.values()) {
        if (waiting) {
          return;
        }
      }
      onFramesDecoded();
    }

    synchronized private void onFramesDecoded() {
      long timeUS = currentFrame * 1000000L / frameRate;
      for (VideoComposition.Item item: itemsAwaited.keySet()) {
        ImageReader imageReader = imageReaders.get(item);
        VideoCompositionItemDecoder decoder = decoders.get(item);
        if (imageReader == null || decoder == null) {
          continue;
        }
        Image image = imageReader.acquireLatestImage();
        if (image != null) {
          HardwareBuffer hardwareBuffer = image.getHardwareBuffer();
          image.close();
          if (hardwareBuffer != null) {
            String id = item.getId();

            VideoFrame currentFrame = videoFrames.get(id);
            if (currentFrame != null) {
              currentFrame.getBuffer().close();
            }
            videoFrames.put(item.getId(), new VideoFrame(
              hardwareBuffer,
              decoder.getVideoWidth(),
              decoder.getVideoHeight(),
              decoder.getRotation()
            ));
          }
        }
      }
      renderFrame(timeUS, videoFrames);
      int nbFrames = (int) Math.floor(frameRate * composition.getDuration());
      boolean eos = currentFrame == nbFrames - 1;
      encoder.drainEncoder(eos);
      if (!eos) {
        currentFrame+=1;
        handler.sendEmptyMessage(DECODE_NEXT_VIDEOS_FRAME);
      } else {
        completeListener.onComplete();
      }
    }

    public void release() {
      releasing = true;
      if (decoders != null) {
        decoders.values().forEach(VideoCompositionItemDecoder::release);
      }
      if (imageReaders != null) {
        imageReaders.values().forEach(ImageReader::close);
      }
      encoder.release();
    }

    private interface OnCompleteListener {
      void onComplete();
    }

    private interface OnErrorListener {
      void onError(Exception e);
    }
  }
}
