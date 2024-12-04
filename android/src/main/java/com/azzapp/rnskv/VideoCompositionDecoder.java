package com.azzapp.rnskv;

import java.util.HashMap;
import java.util.Map;

import javax.microedition.khronos.egl.EGLContext;

/**
 * A class to decode a video composition and extract frames from the video items.
 */
public class VideoCompositionDecoder {

  private final VideoComposition composition;

  private final HashMap<VideoComposition.Item, VideoCompositionItemDecoder> decoders;

  private EGLResourcesHolder eglResourcesHolder;

  private final HashMap<VideoComposition.Item, GLFrameExtractor> glFrameExtractors;

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
    glFrameExtractors = new HashMap<>();
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
  public void prepare(EGLContext sharedContext) {
    eglResourcesHolder = EGLResourcesHolder.createWithPBBufferSurface(sharedContext);
    eglResourcesHolder.makeCurrent();
    decoders.values().forEach(decoder -> {
      try {
        decoder.prepare();

        VideoComposition.Item item = decoder.getItem();
        GLFrameExtractor glFrameExtractor = new GLFrameExtractor();

        glFrameExtractor.setOnFrameAvailableListener(() -> {
          if (onItemImageAvailableListener != null) {
            onItemImageAvailableListener.onItemImageAvailable(item);
          }
        });
        glFrameExtractors.put(item, glFrameExtractor);
        decoder.setSurface(glFrameExtractor.getSurface());
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
   * Updates the video frames of the composition and return them
   *
   * @return A map with the updated video frames.
   */
  public Map<String, VideoFrame> updateVideosFrames() {
    for (VideoComposition.Item item : composition.getItems()) {
      GLFrameExtractor glFrameExtractor = glFrameExtractors.get(item);
      VideoCompositionItemDecoder decoder = decoders.get(item);
      if (eglResourcesHolder == null || glFrameExtractor == null || decoder == null) {
        continue;
      }
      eglResourcesHolder.makeCurrent();
      boolean shouldDownScale = item.getWidth() > 0 && item.getHeight() > 0;
      int width = shouldDownScale ? item.getWidth() : decoder.getVideoWidth();
      int height = shouldDownScale ? item.getHeight() : decoder.getVideoHeight();
      if (!glFrameExtractor.decodeNextFrame(width, height)) {
        continue;
      }
      VideoFrame nextFrame = new VideoFrame(
        glFrameExtractor.getOutputTexId(),
        width, height, 0,
        glFrameExtractor.getLatestTimeStampNs()
      );
      String id = item.getId();
      videoFrames.put(id, nextFrame);
    }
    return videoFrames;
  }

  /**
   * Seeks to the given position.
   *
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
    videoFrames.clear();
    glFrameExtractors.values().forEach(GLFrameExtractor::release);
    glFrameExtractors.clear();
    if (eglResourcesHolder != null) {
      eglResourcesHolder.release();
    }
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


