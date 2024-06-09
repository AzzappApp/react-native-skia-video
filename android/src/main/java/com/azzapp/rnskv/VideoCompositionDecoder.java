package com.azzapp.rnskv;

import android.media.Image;
import android.media.ImageReader;
import android.os.Handler;
import android.os.Looper;

import java.util.HashMap;
import java.util.Map;
import java.util.Objects;

/**
 * A class to decode a video composition and extract frames from the video items.
 */
public class VideoCompositionDecoder {

  private final VideoComposition composition;

  private final HashMap<VideoComposition.Item, VideoCompositionItemDecoder> decoders;

  private final HashMap<VideoComposition.Item, ImageReader> imageReaders;

  private final HashMap<String, VideoFrame> videoFrames = new HashMap<>();

  private OnItemImageAvailableListener onItemImageAvailableListener;

  private OnFrameAvailableListener onFrameAvailableListener;

  private OnErrorListener onErrorListener;

  private OnItemEndReachedListener onItemEndReachedListener;

  /**
   * Creates a new video composition decoder.
   *
   * @param composition The video composition to decode.
   */
  public VideoCompositionDecoder(VideoComposition composition) {
    this.composition = composition;
    decoders = new HashMap<>();
    imageReaders = new HashMap<>();
    composition.getItems().forEach(item -> {
      VideoCompositionItemDecoder decoder = new VideoCompositionItemDecoder(item);
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
   * Prepares the items decoders and the image readers.
   */
  public void prepare() {
    Handler handler = new Handler(Objects.requireNonNull(Looper.myLooper()));
    decoders.values().forEach(decoder -> {
      try {
        decoder.prepare();
        ImageReader imageReader;
        VideoComposition.Item item = decoder.getItem();
        imageReader = ImageReaderHelpers.createImageReader(decoder.getVideoWidth(), decoder.getVideoHeight());
        imageReader.setOnImageAvailableListener(reader -> {
          if (onItemImageAvailableListener != null) {
            onItemImageAvailableListener.onItemImageAvailable(item);
          }
        }, handler);
        imageReaders.put(item, imageReader);
        decoder.setSurface(imageReader.getSurface());
      } catch (Exception e) {
        throw new RuntimeException(e);
      }
    });
  }

  /**
   * Starts the decoders.
   */
  public void start() {
    decoders.values().forEach(VideoCompositionItemDecoder::start);
  }

  /**
   * Sets the listener to be called when an image is available.
   * @param onItemImageAvailableListener The listener to be called.
   */
  public void setOnItemImageAvailableListener(OnItemImageAvailableListener onItemImageAvailableListener) {
    this.onItemImageAvailableListener = onItemImageAvailableListener;
  }

  /**
   * Sets the listener to be called when an error occurs.
   * @param onErrorListener The listener to be called.
   */
  public void setOnErrorListener(OnErrorListener onErrorListener) {
    this.onErrorListener = onErrorListener;
  }

  /**
   * Sets the listener to be called when a frame has been decoded.
   * @param onFrameAvailableListener The listener to be called.
   */
  public void setOnFrameAvailableListener(OnFrameAvailableListener onFrameAvailableListener) {
    this.onFrameAvailableListener = onFrameAvailableListener;
  }

  /**
   * Sets the listener to be called when an item reaches its end.
   * @param onItemEndReachedListener The listener to be called.
   */
  public void setOnItemEndReachedListener(OnItemEndReachedListener onItemEndReachedListener) {
    this.onItemEndReachedListener = onItemEndReachedListener;
  }

  /**
   * Renders the video composition at the given position.
   * @param currentPositionUs The current position in microseconds.
   * @return A map with the rendered times for each item.
   */
  public synchronized Map<String, Long> render(long currentPositionUs) {
    Map<String, Long> renderedTimes = new HashMap<>();
    decoders.forEach((item, decoder) -> {
      renderedTimes.put(item.getId(), decoder.render(currentPositionUs));
    });
    return renderedTimes;
  }

  /**
   * Gets the updated video frames.
   * @return A map with the updated video frames.
   */
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
      VideoFrame nextFrame = VideoFrame.create(image, decoder.getRotation());
      if (nextFrame == null) {
        image.close();
        continue;
      }
      String id = item.getId();
      VideoFrame currentFrame = videoFrames.get(id);
      if (currentFrame != null) {
        currentFrame.release();
      }
      videoFrames.put(id, nextFrame);
    }
    return videoFrames;
  }

  /**
   * Seeks to the given position.
   * @param position The position to seek to in microseconds.
   */
  synchronized public void seekTo(long position) {
    decoders.values().forEach(itemDecoder -> itemDecoder.seekTo(position));
  }

  /**
   * Releases the resources.
   */
  synchronized public void release() {
    decoders.values().forEach(VideoCompositionItemDecoder::release);
    decoders.clear();
    videoFrames.values().forEach(VideoFrame::release);
    videoFrames.clear();
    imageReaders.values().forEach(ImageReader::close);
    imageReaders.clear();
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


