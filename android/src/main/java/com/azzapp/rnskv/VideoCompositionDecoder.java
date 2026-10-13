package com.azzapp.rnskv;

import android.os.Build;
import android.view.Surface;

import java.util.HashMap;
import java.util.Map;

/**
 * A class to decode a video composition and extract frames from the video items.
 */
public class VideoCompositionDecoder {

  /**
   * Whether React Native Skia's device can sample the decoders' own YUV
   * buffers: JS checks it once (see setYUVFramesSupported in JS).
   */
  private static volatile boolean yuvFramesSupported = false;

  /**
   * An explicit choice to hand the frames over in YUV buffers or not,
   * overriding yuvFramesSupported, or null.
   */
  private static volatile Boolean yuvFramesEnabled = null;

  /**
   * Whether the decoders hand their frames over in their own YUV buffers,
   * converted to RGB on React Native Skia's device
   * ({@link ImageReaderFrameExtractor}), rather than rendered into RGBA buffers
   * with OpenGL ({@link GLFrameExtractor}): when Skia's device can sample them,
   * unless disabled. It applies to the decoders prepared next.
   */
  private static boolean useYUVFrames() {
    Boolean enabled = yuvFramesEnabled;
    // ImageReader only allocates GPU-sampleable buffers from Android 10 on.
    return (enabled != null ? enabled : yuvFramesSupported)
      && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q;
  }

  public static void setYUVFramesSupported(boolean supported) {
    yuvFramesSupported = supported;
  }

  public static void setYUVFramesEnabled(boolean enabled) {
    yuvFramesEnabled = enabled;
  }

  private final VideoComposition composition;

  private final HashMap<VideoComposition.Item, VideoCompositionItemDecoder> decoders;

  private EGLResourcesHolder eglResourcesHolder;

  private final HashMap<VideoComposition.Item, GLFrameExtractor> glFrameExtractors;

  private final HashMap<VideoComposition.Item, ImageReaderFrameExtractor> yuvFrameExtractors =
    new HashMap<>();

  private final HashMap<String, VideoFrame> videoFrames = new HashMap<>();

  /** The time spent getting frames from the frame extractors (see ExportDiagnostics). */
  private long acquireNs = 0;

  private OnItemImageAvailableListener onItemImageAvailableListener;

  private OnFrameAvailableListener onFrameAvailableListener;

  private OnErrorListener onErrorListener;

  private OnItemEndReachedListener onItemEndReachedListener;

  /**
   * Creates a new video composition decoder.
   *
   * @param composition The video composition to decode.
   * @param realtime    Whether the frames are decoded for playback, at the
   *                    pace of the videos, rather than as fast as possible
   *                    (export).
   */
  public VideoCompositionDecoder(VideoComposition composition, boolean realtime) {
    this.composition = composition;
    decoders = new HashMap<>();
    glFrameExtractors = new HashMap<>();
    composition.getItems().forEach(item -> {
      if (!item.isVideo()) {
        return;
      }
      VideoCompositionItemDecoder decoder = new VideoCompositionItemDecoder(item, realtime);
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
    boolean yuvFrames = useYUVFrames();
    if (!yuvFrames) {
      eglResourcesHolder = EGLResourcesHolder.createWithPBBufferSurface();
      eglResourcesHolder.makeCurrent();
    }
    decoders.values().forEach(decoder -> {
      try {
        decoder.prepare();

        VideoComposition.Item item = decoder.getItem();
        GLFrameExtractor.OnFrameAvailableListener onFrameAvailable = () -> {
          if (onItemImageAvailableListener != null) {
            onItemImageAvailableListener.onItemImageAvailable(item);
          }
        };
        Surface surface;
        if (yuvFrames) {
          ImageReaderFrameExtractor yuvFrameExtractor = new ImageReaderFrameExtractor(
            decoder.getVideoWidth(), decoder.getVideoHeight());
          yuvFrameExtractor.setOnFrameAvailableListener(onFrameAvailable);
          yuvFrameExtractors.put(item, yuvFrameExtractor);
          surface = yuvFrameExtractor.getSurface();
        } else {
          GLFrameExtractor glFrameExtractor = new GLFrameExtractor();
          glFrameExtractor.setOnFrameAvailableListener(onFrameAvailable);
          glFrameExtractors.put(item, glFrameExtractor);
          surface = glFrameExtractor.getSurface();
        }
        decoder.setSurface(surface);
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
  public synchronized Map<String, VideoFrame> updateVideosFrames() {
    for (VideoComposition.Item item : composition.getItems()) {
      if (!item.isVideo()) {
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
      if (decoder.getRotation() == 90 || decoder.getRotation() == 270) {
        int temp = frameWidth;
        frameWidth = frameHeight;
        frameHeight = temp;
      }
      VideoFrame nextFrame;
      ImageReaderFrameExtractor yuvFrameExtractor = yuvFrameExtractors.get(item);
      GLFrameExtractor glFrameExtractor = glFrameExtractors.get(item);
      long acquireStartNs = System.nanoTime();
      if (yuvFrameExtractor != null) {
        boolean decoded = yuvFrameExtractor.decodeNextFrame();
        acquireNs += System.nanoTime() - acquireStartNs;
        if (!decoded) {
          continue;
        }
        nextFrame = new VideoFrame(
          yuvFrameExtractor.getOutputBuffer(),
          frameWidth, frameHeight,
          yuvFrameExtractor.getLatestTimeStampNs(),
          yuvFrameExtractor.getCropRect(decoder.getVideoWidth(), decoder.getVideoHeight()),
          decoder.getRotation()
        );
      } else {
        if (eglResourcesHolder == null || glFrameExtractor == null) {
          continue;
        }
        eglResourcesHolder.makeCurrent();
        boolean decoded = glFrameExtractor.decodeNextFrame(frameWidth, frameHeight);
        acquireNs += System.nanoTime() - acquireStartNs;
        if (!decoded) {
          continue;
        }
        nextFrame = new VideoFrame(
          glFrameExtractor.getOutputBuffer(),
          frameWidth, frameHeight, 0,
          glFrameExtractor.getLatestTimeStampNs()
        );
      }
      String id = item.getId();
      videoFrames.put(id, nextFrame);
    }
    return videoFrames;
  }

  /**
   * @return whether the frames are handed over in the decoders' own YUV buffers
   */
  public synchronized boolean usesYUVFrames() {
    return !yuvFrameExtractors.isEmpty();
  }

  /**
   * @return the frames the decoder of the item decoded and did not render yet
   */
  public synchronized int getPendingFramesCount(VideoComposition.Item item) {
    VideoCompositionItemDecoder decoder = decoders.get(item);
    return decoder != null ? decoder.getPendingFramesCount() : 0;
  }

  /**
   * @return the time spent getting frames from the frame extractors since the
   * last call, in nanoseconds
   */
  public synchronized long takeAcquireNs() {
    long ns = acquireNs;
    acquireNs = 0;
    return ns;
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
    yuvFrameExtractors.values().forEach(ImageReaderFrameExtractor::release);
    yuvFrameExtractors.clear();
    // The GL deletes below require this context to be current on the
    // calling thread.
    if (eglResourcesHolder != null) {
      eglResourcesHolder.makeCurrent();
    }
    glFrameExtractors.values().forEach(GLFrameExtractor::release);
    glFrameExtractors.clear();
    if (eglResourcesHolder != null) {
      eglResourcesHolder.release();
      eglResourcesHolder = null;
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


