package com.azzapp.rnskv;

import android.os.Handler;

import androidx.annotation.Nullable;

import java.io.IOException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * A class to decode a video composition and extract frames from the video items.
 *
 * Only the decoders of the items live around the current position are open (see
 * {@link #updateDecoders}): a long composition costs the decoders, and the buffers, of the items
 * around its current time, not of all of them, and it can have more items than the device has
 * decoder instances.
 */
public class VideoCompositionDecoder {

  private final VideoComposition composition;

  private final HashMap<VideoComposition.Item, VideoCompositionItemDecoder> decoders;

  // The decoders hand their frames over in their own YUV buffers, converted to RGB by JS.
  private final HashMap<VideoComposition.Item, ImageReaderFrameExtractor> frameExtractors =
    new HashMap<>();

  private final HashMap<String, VideoFrame> videoFrames = new HashMap<>();

  private OnItemImageAvailableListener onItemImageAvailableListener;

  private OnFrameAvailableListener onFrameAvailableListener;

  private OnErrorListener onErrorListener;

  private OnItemEndReachedListener onItemEndReachedListener;

  private volatile boolean started = false;

  /**
   * The handler the decoders' callbacks run on, or null for the looper of the thread opening them.
   */
  @Nullable
  private Handler callbackHandler;

  /**
   * Creates a new video composition decoder.
   *
   * @param composition The video composition to decode.
   * @param forExport   Whether it decodes for an export, as fast as it can, rather than in real
   *                    time.
   */
  public VideoCompositionDecoder(VideoComposition composition, boolean forExport) {
    this.composition = composition;
    decoders = new HashMap<>();
    composition.getItems().forEach(item -> {
      if (!item.isVideo()) {
        return;
      }
      VideoCompositionItemDecoder decoder = new VideoCompositionItemDecoder(item, forExport);
      decoder.setOnErrorListener(error -> {
        if (onErrorListener != null) {
          onErrorListener.onError(error);
        }
      });

      decoder.setOnFrameAvailableListener(presentationTimeUs -> {
        if (onFrameAvailableListener != null) {
          onFrameAvailableListener.onFrameAvailable(item, presentationTimeUs);
        }
      });

      decoder.setOnEndReachedListener(() -> {
        if (onItemEndReachedListener != null) {
          onItemEndReachedListener.onItemEndReached(item);
        }
      });
      decoders.put(item, decoder);
    });
  }

  /**
   * Reads the format of the items and prepares their image readers. The decoders are opened by
   * {@link #updateDecoders}.
   */
  public void prepare() {
    decoders.values().forEach(decoder -> {
      try {
        decoder.prepare();

        VideoComposition.Item item = decoder.getItem();
        ImageReaderFrameExtractor frameExtractor = new ImageReaderFrameExtractor(
          decoder.getVideoWidth(), decoder.getVideoHeight());
        frameExtractor.setOnFrameAvailableListener(() -> {
          if (onItemImageAvailableListener != null) {
            onItemImageAvailableListener.onItemImageAvailable(item);
          }
        });
        frameExtractors.put(item, frameExtractor);
        decoder.setSurface(frameExtractor.getSurface());
      } catch (Exception e) {
        throw new RuntimeException(e);
      }
    });
  }

  /**
   * Lets {@link #updateDecoders} open the decoders.
   */
  public void start() {
    started = true;
  }

  /**
   * Sets the handler the decoders' callbacks run on, rather than the looper of the thread opening
   * them (see {@link #updateDecoders}).
   */
  public void setCallbackHandler(@Nullable Handler callbackHandler) {
    this.callbackHandler = callbackHandler;
  }

  /**
   * The position of the composition an item is decoded from at the given position, or null if
   * its decoder is closed: while it is open (see {@link VideoComposition.Item#isDecodedAt}), and,
   * when the composition loops, while it is open at the same position of the next loop (the items
   * of its start are opened before it loops).
   */
  private Long getDecodingPosition(VideoComposition.Item item, long positionUs, boolean looping) {
    if (item.isDecodedAt(positionUs)) {
      return positionUs;
    }
    long durationUs = TimeHelpers.secToUs(composition.getDuration());
    if (looping && item.isDecodedAt(positionUs - durationUs)) {
      return positionUs - durationUs;
    }
    return null;
  }

  /**
   * Opens the decoders of the items decoded at the given position (see
   * {@link VideoComposition.Item#isDecodedAt}), decoding from it, and closes the others. Their
   * callbacks run on the callback handler (see {@link #setCallbackHandler}), or else on the looper
   * of the calling thread. Creating or releasing a decoder takes tens of milliseconds, without the
   * locks of the frames: the frames of the other items are still rendered and handed out
   * meanwhile, unless this runs on the thread rendering them.
   *
   * @param positionUs The current position in microseconds.
   * @param looping    Whether the composition loops.
   */
  public void updateDecoders(long positionUs, boolean looping) throws IOException {
    if (!started) {
      return;
    }
    List<VideoCompositionItemDecoder> opened = new ArrayList<>();
    for (Map.Entry<VideoComposition.Item, VideoCompositionItemDecoder> entry : decoders.entrySet()) {
      VideoComposition.Item item = entry.getKey();
      VideoCompositionItemDecoder decoder = entry.getValue();
      Long decodingPositionUs = getDecodingPosition(item, positionUs, looping);
      if (decodingPositionUs == null) {
        // Its last frames are released by updateVideosFrames, on the thread that hands them out.
        decoder.close();
      } else if (decoder.open(decodingPositionUs, callbackHandler)) {
        opened.add(decoder);
      }
    }
    startDecoders(opened);
  }

  /**
   * Starts the decoders opened together once they are all created: the items starting at the same
   * time show their first frames together, rather than one decoder creation (tens of milliseconds)
   * after the other.
   */
  private static void startDecoders(List<VideoCompositionItemDecoder> opened) {
    for (VideoCompositionItemDecoder decoder : opened) {
      decoder.start();
    }
  }

  /**
   * Sets the listener to be called when an image is available.
   *
   * @param onItemImageAvailableListener The listener to be called.
   */
  public void setOnItemImageAvailableListener(OnItemImageAvailableListener onItemImageAvailableListener) {
    this.onItemImageAvailableListener = onItemImageAvailableListener;
  }

  /**
   * Sets the listener to be called when an error occurs.
   *
   * @param onErrorListener The listener to be called.
   */
  public void setOnErrorListener(OnErrorListener onErrorListener) {
    this.onErrorListener = onErrorListener;
  }

  /**
   * Sets the listener to be called when a frame has been decoded.
   *
   * @param onFrameAvailableListener The listener to be called.
   */
  public void setOnFrameAvailableListener(OnFrameAvailableListener onFrameAvailableListener) {
    this.onFrameAvailableListener = onFrameAvailableListener;
  }

  /**
   * Sets the listener to be called when an item reaches its end.
   *
   * @param onItemEndReachedListener The listener to be called.
   */
  public void setOnItemEndReachedListener(OnItemEndReachedListener onItemEndReachedListener) {
    this.onItemEndReachedListener = onItemEndReachedListener;
  }

  /**
   * Renders the video composition at the given position.
   *
   * @param currentPositionUs The current position in microseconds.
   * @param looping           Whether the composition loops: the items of its start, opened before
   *                          it loops (see {@link #getDecodingPosition}), render the frames due at
   *                          the same position of the next loop, their first one, rather than all
   *                          the frames they decode until the composition loops.
   * @return A map with the rendered times for each item.
   */
  public synchronized Map<String, Long> render(long currentPositionUs, boolean looping) {
    Map<String, Long> renderedTimes = new HashMap<>();
    decoders.forEach((item, decoder) -> {
      Long decodingPositionUs = getDecodingPosition(item, currentPositionUs, looping);
      renderedTimes.put(item.getId(), decoder.render(
        decodingPositionUs != null ? decodingPositionUs : currentPositionUs));
    });
    return renderedTimes;
  }

  /**
   * Updates the video frames of the items live at the given position (see
   * {@link VideoComposition.Item#isLiveAt}) and returns them. The last frame of an item that is not
   * live is dropped: JS releases what it made of it.
   *
   * @param currentPositionUs The current position in microseconds.
   * @return A map with the latest frame of each live item.
   */
  public synchronized Map<String, VideoFrame> updateVideosFrames(long currentPositionUs) {
    for (VideoComposition.Item item : composition.getItems()) {
      if (!item.isVideo()) {
        continue;
      }
      if (!item.isLiveAt(currentPositionUs)) {
        videoFrames.remove(item.getId());
        // Here rather than when the decoder is closed: the frames handed out last are converted
        // on this thread, after this call.
        ImageReaderFrameExtractor frameExtractor = frameExtractors.get(item);
        if (frameExtractor != null) {
          frameExtractor.releaseFrames();
        }
        continue;
      }
      VideoCompositionItemDecoder decoder = decoders.get(item);
      if (decoder == null) {
        continue;
      }
      int itemWidth = item.getWidth();
      int itemHeight = item.getHeight();
      boolean shouldDownScale = itemWidth > 0 && itemHeight > 0;
      int frameWidth = shouldDownScale ? itemWidth : decoder.getVideoWidth();
      int frameHeight = shouldDownScale ? itemHeight : decoder.getVideoHeight();
      double maxLongSide = item.getMaxLongSide();
      if (!shouldDownScale && maxLongSide > 0) {
        // Resolved HERE, before the rotation swap below: these are the
        // decoder's own dimensions, in the file's encoded orientation. A
        // caller capping the size itself would have to pass encoded
        // dimensions, the ones it cannot know, since every API hands it
        // display dimensions. Asking it for the long side leaves nothing to
        // get wrong.
        int longSide = Math.max(frameWidth, frameHeight);
        if (longSide > maxLongSide) {
          // Even sizes: the frames are 4:2:0, their chroma planes half the size.
          double scale = maxLongSide / longSide;
          frameWidth = Math.max(2, 2 * (int) Math.round(frameWidth * scale / 2));
          frameHeight = Math.max(2, 2 * (int) Math.round(frameHeight * scale / 2));
        }
      }
      if (decoder.getRotation() == 90 || decoder.getRotation() == 270) {
        int temp = frameWidth;
        frameWidth = frameHeight;
        frameHeight = temp;
      }
      ImageReaderFrameExtractor frameExtractor = frameExtractors.get(item);
      if (frameExtractor == null || !frameExtractor.decodeNextFrame()) {
        continue;
      }
      VideoFrame nextFrame = new VideoFrame(
        frameExtractor.getOutputBuffer(),
        frameWidth, frameHeight,
        frameExtractor.getLatestTimeStampNs(),
        frameExtractor.getCropRect(decoder.getVideoWidth(), decoder.getVideoHeight()),
        decoder.getRotation()
      );
      String id = item.getId();
      videoFrames.put(id, nextFrame);
    }
    // A copy: the map is updated on the decoding thread while the caller reads it.
    return new HashMap<>(videoFrames);
  }

  /**
   * Seeks to the given position: the open decoders of the items decoded there seek to it, the
   * others are opened or closed (see {@link #updateDecoders}).
   *
   * @param position The position to seek to in microseconds.
   * @param looping  Whether the composition loops.
   */
  public void seekTo(long position, boolean looping) throws IOException {
    List<VideoCompositionItemDecoder> opened = new ArrayList<>();
    for (Map.Entry<VideoComposition.Item, VideoCompositionItemDecoder> entry : decoders.entrySet()) {
      VideoComposition.Item item = entry.getKey();
      VideoCompositionItemDecoder decoder = entry.getValue();
      Long decodingPositionUs = getDecodingPosition(item, position, looping);
      if (decodingPositionUs == null) {
        decoder.close();
      } else if (decoder.isOpen()) {
        decoder.seekTo(decodingPositionUs);
      } else if (started && decoder.open(decodingPositionUs, callbackHandler)) {
        opened.add(decoder);
      }
    }
    startDecoders(opened);
  }

  /**
   * Releases the resources.
   */
  synchronized public void release() {
    decoders.values().forEach(VideoCompositionItemDecoder::release);
    decoders.clear();
    videoFrames.clear();
    frameExtractors.values().forEach(ImageReaderFrameExtractor::release);
    frameExtractors.clear();
  }

  /**
   * Listener to be called when an image is available.
   */
  public interface OnItemImageAvailableListener {
    void onItemImageAvailable(VideoComposition.Item item);
  }

  /**
   * Listener to be called when an item reaches its end.
   */
  public interface OnItemEndReachedListener {
    void onItemEndReached(VideoComposition.Item item);
  }

  /**
   * Listener to be called when a frame is available.
   */
  public interface OnFrameAvailableListener {
    void onFrameAvailable(VideoComposition.Item item, long presentationTimeUs);
  }

  /**
   * Listener to be called when an error occurs.
   */
  public interface OnErrorListener {
    void onError(Exception e);
  }
}


