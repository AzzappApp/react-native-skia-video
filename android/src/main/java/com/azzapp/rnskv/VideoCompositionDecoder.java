package com.azzapp.rnskv;

import android.os.Build;
import android.view.Surface;

import java.io.IOException;
import java.util.HashMap;
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

  private OnItemImageAvailableListener onItemImageAvailableListener;

  private OnFrameAvailableListener onFrameAvailableListener;

  private OnErrorListener onErrorListener;

  private OnItemEndReachedListener onItemEndReachedListener;

  private volatile boolean started = false;

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
      if (!item.isVideo()) {
        return;
      }
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
   * Reads the format of the items and prepares their image readers. The decoders are opened by
   * {@link #updateDecoders}.
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
   * Lets {@link #updateDecoders} open the decoders.
   */
  public void start() {
    started = true;
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
   * {@link VideoComposition.Item#isDecodedAt}), decoding from it, and closes the others. Called on the thread the decoders' callbacks run on (the looper of the decoding
   * thread), outside of the lock of the frames: the frames of the open items are still handed out
   * while a decoder is created.
   *
   * @param positionUs The current position in microseconds.
   * @param looping    Whether the composition loops.
   */
  public void updateDecoders(long positionUs, boolean looping) throws IOException {
    if (!started) {
      return;
    }
    for (Map.Entry<VideoComposition.Item, VideoCompositionItemDecoder> entry : decoders.entrySet()) {
      VideoComposition.Item item = entry.getKey();
      VideoCompositionItemDecoder decoder = entry.getValue();
      Long decodingPositionUs = getDecodingPosition(item, positionUs, looping);
      if (decodingPositionUs == null) {
        // Its last frames are released by updateVideosFrames, on the thread that hands them out.
        decoder.close();
      } else {
        decoder.open(decodingPositionUs);
      }
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
        ImageReaderFrameExtractor yuvFrameExtractor = yuvFrameExtractors.get(item);
        if (yuvFrameExtractor != null) {
          yuvFrameExtractor.releaseFrames();
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
      VideoFrame nextFrame;
      ImageReaderFrameExtractor yuvFrameExtractor = yuvFrameExtractors.get(item);
      GLFrameExtractor glFrameExtractor = glFrameExtractors.get(item);
      if (yuvFrameExtractor != null) {
        if (!yuvFrameExtractor.decodeNextFrame()) {
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
        if (!glFrameExtractor.decodeNextFrame(frameWidth, frameHeight)) {
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
    for (Map.Entry<VideoComposition.Item, VideoCompositionItemDecoder> entry : decoders.entrySet()) {
      VideoComposition.Item item = entry.getKey();
      VideoCompositionItemDecoder decoder = entry.getValue();
      Long decodingPositionUs = getDecodingPosition(item, position, looping);
      if (decodingPositionUs == null) {
        decoder.close();
      } else if (decoder.isOpen()) {
        decoder.seekTo(decodingPositionUs);
      } else if (started) {
        decoder.open(decodingPositionUs);
      }
    }
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


