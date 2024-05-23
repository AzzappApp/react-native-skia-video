package com.azzapp.rnskv;

import android.graphics.ImageFormat;
import android.hardware.HardwareBuffer;
import android.media.Image;
import android.media.ImageReader;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;

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


  private final VideoComposition composition;

  private final HashMap<VideoComposition.Item, VideoCompositionItemDecoder> decoders;

  private final HashMap<VideoComposition.Item, ImageReader> imageReaders;

  private final HashMap<String, VideoFrame> videoFrames = new HashMap<>();

  private OnItemImageAvailableListener onItemImageAvailableListener;

  private final Map<
    VideoComposition.Item,
    List<VideoCompositionItemDecoder.Frame>
    > pendingFrames = new HashMap<>();

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

  public void setOnItemImageAvailableListener(
    OnItemImageAvailableListener onItemImageAvailableListener) {
    this.onItemImageAvailableListener = onItemImageAvailableListener;
  }

  /* Deltat value that we use to keep input buffer with an advance of time to be sure that decoders
   * Input buffer contains enough data
   */
  private static final long INPUT_DELTA = 500000L;

  public Set<VideoComposition.Item> advance(long currentPosition, boolean forceRendering)
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
        while (true) {
          long presentationTimeUs = itemDecoder.getInputSamplePresentationTimeUS();
          if ((forceRendering && (presentationTimeUs >= startTime + INPUT_DELTA)) ||
            presentationTimeUs >= currentPosition - compositionStartTime + startTime + INPUT_DELTA) {
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
      ArrayList<VideoCompositionItemDecoder.Frame> framesToRelease = new ArrayList<>();

      long compositionStartTime = TimeHelpers.secToUs(item.getCompositionStartTime());
      long startTime = TimeHelpers.secToUs(item.getStartTime());
      long duration = TimeHelpers.secToUs(item.getDuration());
      long compositionDuration = TimeHelpers.secToUs(composition.getDuration());
      long itemPosition = Math.min(
        startTime + currentPosition - compositionStartTime,
        startTime + duration
      );
      itemPosition = Math.min(startTime + compositionDuration, itemPosition);

      boolean force = forceRendering;
      List<VideoCompositionItemDecoder.Frame> itemFramesCopy = new ArrayList<>(itemFrames);
      for (VideoCompositionItemDecoder.Frame frame : itemFramesCopy) {
        long presentationTimeUS = frame.getPresentationTimeUs();
        if (force || presentationTimeUS <= itemPosition) {
          if (presentationTimeUS < startTime) {
            framesToRelease.add(frame);
          } else {
            framesToRender.add(frame);
            force = false;
            updatedItems.add(item);
          }
        }
      }
      itemFrames.removeAll(framesToRelease);
      framesToRelease.forEach(VideoCompositionItemDecoder.Frame::release);

      itemFrames.removeAll(framesToRender);
      framesToRender.forEach(VideoCompositionItemDecoder.Frame::render);
    }
    return updatedItems;
  }

  public Map<String, VideoFrame> getUpdatedVideoFrames() {
    for (VideoComposition.Item item : composition.getItems()) {
      ImageReader imageReader = imageReaders.get(item);
      VideoCompositionItemDecoder decoder = decoders.get(item);
      if (imageReader == null || decoder == null) {
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
      VideoFrame currentFrame = videoFrames.get(id);
      if (currentFrame != null) {
        currentFrame.getBuffer().close();
      }
      videoFrames.put(id, new VideoFrame(
        hardwareBuffer,
        decoder.getVideoWidth(),
        decoder.getVideoHeight(),
        decoder.getRotation()
      ));
    }
    return videoFrames;
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
    videoFrames.values().forEach(frame -> ((HardwareBuffer) frame.getHardwareBuffer()).close());
  }

  public interface OnItemImageAvailableListener {
    void onItemImageAvailable(VideoComposition.Item item);
  }
}


