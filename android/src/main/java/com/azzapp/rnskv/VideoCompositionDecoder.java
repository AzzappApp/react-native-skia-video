package com.azzapp.rnskv;

import android.os.Handler;
import android.os.HandlerThread;
import android.util.Log;

import java.io.IOException;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentLinkedQueue;

import javax.microedition.khronos.egl.EGLContext;

/**
 * A class to decode a video composition and extract frames from the video items.
 *
 * With lazy decoders an item has a decoder only around its own time (see
 * {@link DecoderWindow}); otherwise every item has one from prepare to release.
 */
public class VideoCompositionDecoder {

  private static final String TAG = "VideoCompositionDecoder";

  private static final long OPENER_JOIN_MS = 1000;

  private final VideoComposition composition;

  private final boolean realTime;

  private final DecoderWindow window;

  /**
   * The items that have a decoder, or one on its way. Written under this
   * object's lock, read from the GL thread without it.
   */
  private final ConcurrentHashMap<VideoComposition.Item, Slot> slots = new ConcurrentHashMap<>();

  /**
   * Items out of their window. Their GL objects go once their codec has, since
   * it draws into them until then.
   */
  private final ConcurrentLinkedQueue<Slot> retired = new ConcurrentLinkedQueue<>();

  private EGLResourcesHolder eglResourcesHolder;

  private final HashMap<String, VideoFrame> videoFrames = new HashMap<>();

  private long framesVersion = 0;

  private boolean started = false;

  private volatile boolean released = false;

  private long seekGeneration = 0;

  private long seekPositionUs = 0;

  private HandlerThread openerThread;

  private Handler opener;

  private HandlerThread callbackThread;

  private Handler callbacks;

  private OnItemImageAvailableListener onItemImageAvailableListener;

  private OnFrameAvailableListener onFrameAvailableListener;

  private OnErrorListener onErrorListener;

  private OnErrorListener onOpenErrorListener;

  private OnItemEndReachedListener onItemEndReachedListener;

  /**
   * Creates a new video composition decoder.
   *
   * @param composition The video composition to decode.
   * @param realTime    true for the preview, whose GL work happens on the thread
   *                    asking for frames and its playback on another; false for
   *                    the export, which does everything on one thread
   */
  public VideoCompositionDecoder(VideoComposition composition, boolean realTime) {
    this.composition = composition;
    this.realTime = realTime;
    this.window = DecoderWindow.of(composition.isLazyDecoders(), realTime);
  }

  /**
   * Prepares the items decoders and the image readers.
   */
  public void prepare(EGLContext sharedContext) {
    prepare(sharedContext, 0);
  }

  /**
   * Prepares the decoders of the items open at the given position. The others
   * are opened by {@link #updateWindow} as the position moves.
   */
  public void prepare(EGLContext sharedContext, long positionUs) {
    eglResourcesHolder = EGLResourcesHolder.createWithPBBufferSurface(sharedContext);
    eglResourcesHolder.makeCurrent();
    if (realTime && window.isLazy()) {
      // Opening a codec takes tens of milliseconds: not on the thread that
      // draws, nor the one that plays, nor the one the playing codec calls back on.
      openerThread = new HandlerThread("ReactNativeSkiaVideo-Opener");
      openerThread.start();
      opener = new Handler(openerThread.getLooper());
      callbackThread = new HandlerThread("ReactNativeSkiaVideo-Codecs");
      callbackThread.start();
      callbacks = new Handler(callbackThread.getLooper());
    }
    for (VideoComposition.Item item : composition.getItems()) {
      if (!item.isVideo() || !opens(item, positionUs)) {
        continue;
      }
      Slot slot = new Slot(item, positionUs, seekGeneration);
      slots.put(item, slot);
      try {
        slot.extractor = newExtractor(item);
        slot.decoder = openCodec(slot);
      } catch (Exception e) {
        throw new RuntimeException(e);
      }
    }
  }

  /**
   * Starts the decoders.
   */
  public synchronized void start() {
    started = true;
    for (Slot slot : slots.values()) {
      VideoCompositionItemDecoder decoder = slot.decoder;
      if (decoder != null) {
        decoder.start();
      }
    }
  }

  /**
   * Opens the decoders of the items coming up at the given position and closes
   * those of the items left behind. Does nothing without lazy decoders.
   *
   * The export calls it from its GL thread, where decoders open on the spot.
   * The preview calls it from its playback thread: the GL thread makes the
   * surface on its next {@link #updateVideosFrames}, then the opener the codec.
   *
   * @param positionUs the composition time
   */
  public synchronized void updateWindow(long positionUs) {
    if (released || !window.isLazy()) {
      return;
    }
    for (VideoComposition.Item item : composition.getItems()) {
      if (!item.isVideo()) {
        continue;
      }
      Slot slot = slots.get(item);
      if (slot == null && opens(item, positionUs)) {
        Log.d(TAG, "open " + item.getId() + " at " + positionUs + "us");
        slot = new Slot(item, positionUs, seekGeneration);
        slots.put(item, slot);
        if (!realTime) {
          openNow(slot);
        }
      } else if (slot != null && !keeps(item, positionUs)) {
        Log.d(TAG, "close " + item.getId() + " at " + positionUs + "us");
        slots.remove(item);
        retire(slot);
      }
    }
  }

  /**
   * @return whether the item has a decoder, which is always the case without
   * lazy decoders once prepared
   */
  public boolean isOpen(VideoComposition.Item item) {
    Slot slot = slots.get(item);
    return slot != null && slot.decoder != null;
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
   * Sets the listener for a decoder that could not be opened lazily; falls
   * back to the error listener. Unlike a codec's passing errors, the item
   * will show no frame.
   */
  public void setOnOpenErrorListener(OnErrorListener onOpenErrorListener) {
    this.onOpenErrorListener = onOpenErrorListener;
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
    slots.forEach((item, slot) -> {
      VideoCompositionItemDecoder decoder = slot.decoder;
      if (decoder != null) {
        renderedTimes.put(item.getId(), decoder.render(currentPositionUs));
      }
    });
    return renderedTimes;
  }

  /**
   * Updates the video frames of the composition and return them
   *
   * @return A map with the updated video frames.
   */
  public Map<String, VideoFrame> updateVideosFrames() {
    if (eglResourcesHolder == null) {
      return videoFrames;
    }
    boolean current = false;
    for (Iterator<Slot> it = retired.iterator(); it.hasNext(); ) {
      Slot slot = it.next();
      if (!slot.closed) {
        continue;
      }
      it.remove();
      GLFrameExtractor extractor;
      synchronized (slot) {
        extractor = slot.extractor;
        slot.extractor = null;
      }
      if (extractor != null) {
        if (!current) {
          eglResourcesHolder.makeCurrent();
          current = true;
        }
        extractor.release();
      }
      // The item may have been reopened since, and drawn its own frame.
      String id = slot.item.getId();
      if (slot.frame != null && videoFrames.get(id) == slot.frame) {
        videoFrames.remove(id);
        framesVersion++;
      }
    }
    for (VideoComposition.Item item : composition.getItems()) {
      if (!item.isVideo()) {
        continue;
      }
      Slot slot = slots.get(item);
      if (slot == null) {
        continue;
      }
      if (!current) {
        eglResourcesHolder.makeCurrent();
        current = true;
      }
      GLFrameExtractor glFrameExtractor = slot.extractor;
      if (glFrameExtractor == null) {
        makeSurface(slot);
        continue;
      }
      VideoCompositionItemDecoder decoder = slot.decoder;
      if (decoder == null) {
        continue;
      }
      if (glFrameExtractor.isDirect()) {
        // The decoder's buffer itself: no texture of the item's own, and no
        // resize, rotation or crop, which the frame describes instead.
        int pictureWidth = decoder.getVideoWidth();
        int pictureHeight = decoder.getVideoHeight();
        if (!glFrameExtractor.decodeNextFrame(pictureWidth, pictureHeight)) {
          continue;
        }
        VideoFrame nextFrame = new VideoFrame(
          glFrameExtractor.getInputTexId(), VideoFrame.TARGET_EXTERNAL,
          glFrameExtractor.getBufferWidth(), glFrameExtractor.getBufferHeight(),
          decoder.getRotation(), glFrameExtractor.getLatestTimeStampNs(),
          0, 0, pictureWidth, pictureHeight
        );
        slot.frame = nextFrame;
        videoFrames.put(item.getId(), nextFrame);
        framesVersion++;
        continue;
      }
      // The decoder still decodes the whole picture; the cap sizes the texture
      // it is drawn into, which is what an item holds for the life of the player.
      int[] size = FrameSize.of(
        item.getWidth(),
        item.getHeight(),
        item.getMaxLongSide(),
        decoder.getVideoWidth(),
        decoder.getVideoHeight(),
        decoder.getRotation()
      );
      int frameWidth = size[0];
      int frameHeight = size[1];
      if (!glFrameExtractor.decodeNextFrame(frameWidth, frameHeight)) {
        continue;
      }
      VideoFrame nextFrame = new VideoFrame(
        glFrameExtractor.getOutputTexId(),
        frameWidth, frameHeight, 0,
        glFrameExtractor.getLatestTimeStampNs()
      );
      slot.frame = nextFrame;
      videoFrames.put(item.getId(), nextFrame);
      framesVersion++;
    }
    return videoFrames;
  }

  /**
   * @return a counter incremented every time {@link #updateVideosFrames}
   * produced a new frame for an item. Comparing two values tells an unchanged
   * frame set from a fresh one without inspecting the frames.
   */
  public long getFramesVersion() {
    return framesVersion;
  }

  /**
   * Makes the decoder's GL context current on the calling thread, where its
   * frames are decoded.
   */
  public void makeGLContextCurrent() {
    if (eglResourcesHolder != null) {
      eglResourcesHolder.makeCurrent();
    }
  }

  /**
   * Seeks to the given position.
   *
   * @param position The position to seek to in microseconds.
   */
  synchronized public void seekTo(long position) {
    seekPositionUs = position;
    seekGeneration++;
    for (Slot slot : slots.values()) {
      VideoCompositionItemDecoder decoder = slot.decoder;
      if (decoder != null) {
        decoder.seekTo(position);
      }
    }
  }

  /**
   * Releases the resources.
   */
  public void release() {
    // A codec being opened draws into a surface released below. Waited for
    // outside of the lock, which the opener takes to hand its codec over.
    if (openerThread != null) {
      openerThread.quit();
      boolean interrupted = Thread.interrupted();
      try {
        openerThread.join(OPENER_JOIN_MS);
      } catch (InterruptedException e) {
        interrupted = true;
      }
      if (interrupted) {
        Thread.currentThread().interrupt();
      }
    }
    synchronized (this) {
      released = true;
      for (Slot slot : slots.values()) {
        releaseCodec(slot);
      }
      for (Slot slot : retired) {
        releaseCodec(slot);
      }
    }
    videoFrames.clear();
    // The GL deletes below require this context to be current on the
    // calling thread.
    if (eglResourcesHolder != null) {
      eglResourcesHolder.makeCurrent();
    }
    for (Slot slot : slots.values()) {
      releaseExtractor(slot);
    }
    for (Slot slot : retired) {
      releaseExtractor(slot);
    }
    slots.clear();
    retired.clear();
    if (eglResourcesHolder != null) {
      eglResourcesHolder.release();
    }
    if (callbackThread != null) {
      callbackThread.quit();
    }
  }

  private boolean opens(VideoComposition.Item item, long positionUs) {
    long startUs = TimeHelpers.secToUs(item.getCompositionStartTime());
    return window.opens(startUs, startUs + TimeHelpers.secToUs(item.getDuration()), positionUs);
  }

  private boolean keeps(VideoComposition.Item item, long positionUs) {
    long startUs = TimeHelpers.secToUs(item.getCompositionStartTime());
    return window.keeps(startUs, startUs + TimeHelpers.secToUs(item.getDuration()), positionUs);
  }

  /**
   * The export's path: this thread has the GL context and the codec callbacks.
   */
  private void openNow(Slot slot) {
    try {
      eglResourcesHolder.makeCurrent();
      slot.extractor = newExtractor(slot.item);
      VideoCompositionItemDecoder decoder = openCodec(slot);
      slot.decoder = decoder;
      if (started) {
        decoder.start();
      }
    } catch (Exception e) {
      releaseCodec(slot);
      reportOpenError(e);
    }
  }

  /**
   * The preview's path, on the GL thread: the surface here, then the codec on
   * the opener. Tried once; a failure leaves the item without frames.
   */
  private void makeSurface(Slot slot) {
    if (opener == null) {
      return;
    }
    synchronized (slot) {
      // released is read under the slot lock, which release() takes after
      // setting it: a surface made here is one release() will see.
      if (released || slot.retired || slot.failed || slot.extractor != null) {
        return;
      }
      try {
        slot.extractor = newExtractor(slot.item);
      } catch (Exception e) {
        slot.failed = true;
        reportOpenError(e);
        return;
      }
    }
    if (!opener.post(() -> openLater(slot))) {
      releaseExtractor(slot);
    }
  }

  private void openLater(Slot slot) {
    synchronized (slot) {
      if (slot.retired) {
        return;
      }
    }
    VideoCompositionItemDecoder decoder;
    try {
      decoder = openCodec(slot);
    } catch (Exception e) {
      reportOpenError(e);
      return;
    }
    synchronized (this) {
      boolean dropped;
      synchronized (slot) {
        dropped = released || slot.retired;
        if (!dropped) {
          slot.decoder = decoder;
        }
      }
      if (dropped) {
        decoder.release();
        return;
      }
      if (started) {
        try {
          decoder.start();
          if (seekGeneration != slot.seekGeneration) {
            decoder.seekTo(seekPositionUs);
          }
        } catch (RuntimeException e) {
          // Uncaught, this would end the app from the opener thread.
          releaseCodec(slot);
          reportOpenError(e);
        }
      }
    }
  }

  private void retire(Slot slot) {
    synchronized (slot) {
      slot.retired = true;
    }
    retired.add(slot);
    if (opener == null) {
      close(slot);
    } else if (!opener.post(() -> close(slot))) {
      Log.w(TAG, "The opener has quit, the decoder goes with release()");
    }
  }

  private void close(Slot slot) {
    try {
      releaseCodec(slot);
    } catch (RuntimeException e) {
      Log.w(TAG, "Could not release a decoder", e);
    }
    slot.closed = true;
  }

  private static void releaseCodec(Slot slot) {
    VideoCompositionItemDecoder decoder;
    synchronized (slot) {
      decoder = slot.decoder;
      slot.decoder = null;
    }
    if (decoder != null) {
      decoder.release();
    }
  }

  private static void releaseExtractor(Slot slot) {
    GLFrameExtractor extractor;
    synchronized (slot) {
      extractor = slot.extractor;
      slot.extractor = null;
    }
    if (extractor != null) {
      extractor.release();
    }
  }

  private GLFrameExtractor newExtractor(VideoComposition.Item item) {
    GLFrameExtractor glFrameExtractor = new GLFrameExtractor(item.isDirectTexture());
    glFrameExtractor.setOnFrameAvailableListener(() -> {
      if (onItemImageAvailableListener != null) {
        onItemImageAvailableListener.onItemImageAvailable(item);
      }
    });
    return glFrameExtractor;
  }

  private VideoCompositionItemDecoder openCodec(Slot slot) throws IOException {
    VideoComposition.Item item = slot.item;
    VideoCompositionItemDecoder decoder = new VideoCompositionItemDecoder(item);
    decoder.setOnErrorListener(this::reportError);
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
    decoder.setInitialPosition(slot.openAtUs);
    decoder.setCallbackHandler(callbacks);
    try {
      decoder.prepare();
      decoder.setSurface(slot.extractor.getSurface());
    } catch (IOException | RuntimeException e) {
      decoder.release();
      throw e;
    }
    return decoder;
  }

  private void reportOpenError(Exception e) {
    OnErrorListener listener = onOpenErrorListener;
    if (listener != null) {
      listener.onError(e);
    } else {
      reportError(e);
    }
  }

  private void reportError(Exception e) {
    OnErrorListener listener = onErrorListener;
    if (listener != null) {
      listener.onError(e);
    } else {
      Log.w(TAG, "Decoder error", e);
    }
  }

  /**
   * An item's decoder and the surface it draws into.
   */
  private static final class Slot {
    final VideoComposition.Item item;

    /** The composition time the slot was made at, where its codec starts. */
    final long openAtUs;

    /** Tells whether a seek happened while the codec was being opened. */
    final long seekGeneration;

    volatile GLFrameExtractor extractor;

    volatile VideoCompositionItemDecoder decoder;

    /** The last frame this slot put in the frames map. GL thread only. */
    VideoFrame frame;

    /** Guarded by the slot. */
    boolean retired;

    /** Guarded by the slot. */
    boolean failed;

    /** The codec is released, so the surface can go. */
    volatile boolean closed;

    Slot(VideoComposition.Item item, long openAtUs, long seekGeneration) {
      this.item = item;
      this.openAtUs = openAtUs;
      this.seekGeneration = seekGeneration;
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
