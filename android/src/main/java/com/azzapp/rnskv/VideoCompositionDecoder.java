package com.azzapp.rnskv;

import android.graphics.ImageFormat;
import android.hardware.HardwareBuffer;
import android.media.ImageReader;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import androidx.annotation.Nullable;

import java.io.IOException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/**
 * A class that previews a video composition.
 */
public class VideoCompositionDecoder {
  private static final String TAG = "VideoCompositionDecoder";

  private final VideoComposition composition;

  private final HashMap<VideoComposition.Item, VideoCompositionItemDecoder> decoders;

  private final HashMap<VideoComposition.Item, ImageReader> imageReaders;

  private final HashMap<String, VideoFrame> videoFrames = new HashMap<>();


  private OnItemImageAvailableListener onItemImageAvailableListener;

  private final Map<
    VideoComposition.Item,
    List<VideoCompositionItemDecoder.Frame>
    > pendingFrames = new HashMap();

  /**
   * Create a new VideoCompositionFramesExtractor.
   *
   * @param composition the video composition to preview
   */
  public VideoCompositionDecoder(VideoComposition composition) {
    this.composition = composition;
    decoders = new HashMap<>();
    imageReaders = new HashMap<>();
    composition.getItems().forEach(item -> {
      VideoCompositionItemDecoder decoder = new VideoCompositionItemDecoder(item);
      decoders.put(item, decoder);
    });
  }

  public void prepare() {
    Handler handler = new Handler(Objects.requireNonNull(Looper.myLooper()));
    decoders.values().forEach(decoder -> {
      try {
        decoder.prepare();
        ImageReader imageReader;
        VideoComposition.Item item = decoder.getItem();
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
        imageReader.setOnImageAvailableListener(reader -> {
          if (onItemImageAvailableListener != null) {
            onItemImageAvailableListener.onItemImageAvailable(item);
          }
        }, handler);
        imageReaders.put(item, imageReader);
        decoder.setSurface(imageReader.getSurface());
      } catch (IOException e) {
        throw new RuntimeException(e);
      }
    });
  }

  /* Deltat value that we use keep input buffer with an advance of time to be sure that decoders
   * Input buffer contains enough data
   */
  private static final long INPUT_DELTA = 500000L;

  public void setOnItemImageAvailableListener(
    OnItemImageAvailableListener onItemImageAvailableListener) {
    this.onItemImageAvailableListener = onItemImageAvailableListener;
  }

  public Set<VideoComposition.Item> advance(long currentPosition, boolean forceRendering)
    throws IOException, InterruptedException {
    return advance(currentPosition, forceRendering, false);
  }

  public Set<VideoComposition.Item> advance(long currentPosition, boolean forceRendering, boolean verbose)
    throws IOException, InterruptedException {
    for (VideoCompositionItemDecoder itemDecoder : decoders.values()) {
      VideoComposition.Item item = itemDecoder.getItem();
      long compositionStartTime = TimeHelpers.secToUs(item.getCompositionStartTime());
      long startTime = TimeHelpers.secToUs(item.getStartTime());
      long duration = TimeHelpers.secToUs(item.getDuration());
      long compositionDuration = TimeHelpers.secToUs(composition.getDuration());
      if (forceRendering || (
        compositionStartTime <= currentPosition
          && currentPosition <= compositionStartTime + duration + INPUT_DELTA &&
          currentPosition <= compositionDuration + INPUT_DELTA)) {
        if (verbose) Log.i(TAG, "decoding item " + item.getId());
        while (true) {
          long presentationTimeUs = itemDecoder.getInputSamplePresentationTimeUS();
          if (verbose) Log.i(TAG, "Presentation time " + presentationTimeUs);
          if ((forceRendering && (presentationTimeUs >= startTime + INPUT_DELTA)) ||
            presentationTimeUs >= currentPosition + startTime + INPUT_DELTA - compositionStartTime) {
            if (verbose) Log.i(TAG, "Exiting");
            break;
          }
          boolean queued = itemDecoder.queueSampleToCodec();
          if (!queued) {
            if (verbose) Log.i(TAG, "Exiting no more queue");
            break;
          }
        }

        while (true) {
          VideoCompositionItemDecoder.Frame frame = itemDecoder.dequeueOutputBuffer();
          if (frame == null) {
            if (verbose) Log.i(TAG, "No more frame");
            break;
          }
          if (verbose) Log.i(TAG, "Frame found for time : " + frame.getPresentationTimeUs());
          List<VideoCompositionItemDecoder.Frame> itemPendingFrames =
            pendingFrames.computeIfAbsent(item, k -> new ArrayList<>());
          itemPendingFrames.add(frame);
        }
      }
    }

    Set<VideoComposition.Item> updatedItems = new HashSet<>();
    for (
      Map.Entry<VideoComposition.Item, List<VideoCompositionItemDecoder.Frame>> entry :
      pendingFrames.entrySet()) {
      VideoComposition.Item item = entry.getKey();
      List<VideoCompositionItemDecoder.Frame> itemFrames = entry.getValue();
      ArrayList<VideoCompositionItemDecoder.Frame> framesToRender = new ArrayList<>();

      long compositionStartTime = TimeHelpers.secToUs(item.getCompositionStartTime());
      long startTime = TimeHelpers.secToUs(item.getStartTime());
      long duration = TimeHelpers.secToUs(item.getDuration());
      long compositionDuration = TimeHelpers.secToUs(composition.getDuration());
      long itemPosition = Math.min(
        startTime + currentPosition - compositionStartTime,
        startTime + duration
      );
      itemPosition = Math.min(compositionDuration, itemPosition);

      boolean force = forceRendering;
      for (VideoCompositionItemDecoder.Frame frame : itemFrames) {
        if (force || frame.getPresentationTimeUs() <= itemPosition) {
          if (verbose)
            Log.i(TAG, "found frames to render for time " + frame.getPresentationTimeUs());
          framesToRender.add(frame);
          force = false;
          updatedItems.add(item);
        }
      }
      itemFrames.removeAll(framesToRender);
      framesToRender.forEach(VideoCompositionItemDecoder.Frame::render);
    }
    return updatedItems;
  }

  public void seekTo(long position) {
    pendingFrames.values().forEach(frames ->
      frames.forEach(VideoCompositionItemDecoder.Frame::release));
    pendingFrames.clear();
    decoders.values().forEach(itemDecoder -> itemDecoder.seekTo(position));
  }

  public void release() {
    pendingFrames.values().forEach(frames ->
      frames.forEach(VideoCompositionItemDecoder.Frame::release));
    pendingFrames.clear();
    decoders.values().forEach(VideoCompositionItemDecoder::release);
    decoders.clear();
    imageReaders.values().forEach(ImageReader::close);
    imageReaders.clear();
  }

  public @Nullable ImageReader getImageReaderForItem(VideoComposition.Item item) {
    return imageReaders.get(item);
  }

  public @Nullable VideoDimensions getVideoDimensions(VideoComposition.Item item) {
    VideoCompositionItemDecoder decoder = decoders.get(item);
    if (decoder == null) {
      return null;
    }
    return new VideoDimensions(
      decoder.getVideoWidth(),
      decoder.getVideoHeight(),
      decoder.getRotation()
    );
  }

  record VideoDimensions(int width, int height, int rotation) {
  }

  interface OnItemImageAvailableListener {
    public void onItemImageAvailable(VideoComposition.Item item);
  }
}


