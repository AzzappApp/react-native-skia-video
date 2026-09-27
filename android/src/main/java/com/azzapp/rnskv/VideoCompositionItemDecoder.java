package com.azzapp.rnskv;

import android.media.MediaCodec;
import android.media.MediaCodecInfo.CodecProfileLevel;
import android.media.MediaCodecList;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.view.Surface;

import androidx.annotation.NonNull;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.util.ArrayList;
import java.util.List;
import java.util.Stack;

/**
 * A class that decodes a video item from a video composition asynchronously.
 */
public class VideoCompositionItemDecoder extends MediaCodec.Callback {

  private final VideoComposition.Item item;

  private MediaExtractor extractor;

  private MediaCodec codec;

  private MediaFormat format;

  private boolean inputEOS = false;

  private boolean hasRenderedFrame = false;

  private boolean itemEndReached = false;

  private int videoWidth;

  private int videoHeight;

  private int rotation;

  private boolean prepared = false;

  private boolean configured = false;

  private boolean started = false;

  private volatile boolean released = false;

  private Surface surface;

  private long initialPositionUs = 0;

  private Handler callbackHandler;

  /**
   * Set by a seek until the codec's thread has run every callback queued
   * before the flush: those name buffers the flush took back, and handling
   * them after it hands out or drops the buffers of the new position.
   */
  private boolean droppingStaleCallbacks = false;

  private long flushGeneration = 0;

  private final Stack<Frame> freeFrames = new Stack<>();

  private final List<Frame> pendingFrames = new ArrayList<>();

  private OnErrorListener onErrorListener;

  private OnEndReachedListener onEndReachedListener;

  private OnFrameAvailableListener onFrameAvailableListener;

  /**
   * Create a new VideoCompositionItemDecoder.
   *
   * @param item the video composition item to decode
   */
  public VideoCompositionItemDecoder(VideoComposition.Item item) {
    this.item = item;
  }

  /**
   * Prepare the decoder.
   *
   * @throws IOException if the decoder cannot be prepared
   */
  synchronized public void prepare() throws IOException {
    if (prepared) {
      return;
    }
    extractor = new MediaExtractor();
    extractor.setDataSource(item.getPath());
    int trackIndex = selectTrack(extractor);
    if (trackIndex == -1) {
      throw new RuntimeException("No video track");
    }
    format = extractor.getTrackFormat(trackIndex);
    String mime = format.getString(MediaFormat.KEY_MIME);
    if (mime == null) {
      throw new IOException("Could not determine file mime type");
    }
    mime = playableMime(format, mime);
    codec = MediaCodec.createDecoderByType(mime);
    extractor.selectTrack(trackIndex);
    // Capped at the item's end, as on iOS.
    long offsetUs = Math.min(
      Math.max(initialPositionUs - TimeHelpers.secToUs(item.getCompositionStartTime()), 0),
      TimeHelpers.secToUs(item.getDuration()));
    if (item.getStartTime() != 0 || offsetUs != 0) {
      extractor.seekTo(
        TimeHelpers.secToUs(item.getStartTime()) + offsetUs,
        MediaExtractor.SEEK_TO_PREVIOUS_SYNC);
    }
    videoWidth = format.getInteger(MediaFormat.KEY_WIDTH);
    videoHeight = format.getInteger(MediaFormat.KEY_HEIGHT);
    rotation = format.containsKey(MediaFormat.KEY_ROTATION) ? format.getInteger(MediaFormat.KEY_ROTATION) : 0;
    prepared = true;
    configure();
  }

  /**
   * Start the decoder
   */
  synchronized public void start() {
    if (!prepared || !configured || started) {
      return;
    }
    codec.start();
    started = true;
  }

  /**
   * Set the surface to render the video to.
   *
   * @param surface the surface to render the video to
   */
  public void setSurface(Surface surface) {
    this.surface = surface;
    configure();
  }


  /**
   * Where decoding starts, as a composition time, for a decoder opened after
   * its item has begun. Must be called before {@link #prepare}.
   */
  public void setInitialPosition(long compositionTimeUs) {
    initialPositionUs = compositionTimeUs;
  }

  /**
   * The thread the codec calls back on, instead of the one that configures it.
   * Must be called before {@link #setSurface}.
   */
  public void setCallbackHandler(Handler callbackHandler) {
    this.callbackHandler = callbackHandler;
  }

  public void setOnErrorListener(OnErrorListener onErrorListener) {
    this.onErrorListener = onErrorListener;
  }

  public void setOnFrameAvailableListener(OnFrameAvailableListener onFrameAvailableListener) {
    this.onFrameAvailableListener = onFrameAvailableListener;
  }

  public void setOnEndReachedListener(OnEndReachedListener onEndReachedListener) {
    this.onEndReachedListener = onEndReachedListener;
  }

  /**
   * @return the video composition item
   */
  public VideoComposition.Item getItem() {
    return item;
  }

  /**
   * @return the width of the decoded video in pixels after rotation
   */
  public int getVideoWidth() {
    return videoWidth;
  }

  /**
   * @return the height of the decoded video in pixels after rotation
   */
  public int getVideoHeight() {
    return videoHeight;
  }

  /**
   * @return the rotation of the decoded video in degrees
   */
  public int getRotation() {
    return rotation;
  }

  @Override
  synchronized public void onInputBufferAvailable(@NonNull MediaCodec codec, int index) {
    if (!prepared || !configured || released || droppingStaleCallbacks) {
      return;
    }

    if (inputEOS || itemEndReached) {
      try {
        this.codec.queueInputBuffer(index, 0, 0, 0,
          MediaCodec.BUFFER_FLAG_END_OF_STREAM);
      } catch (Throwable e) {}
      return;
    }

    ByteBuffer inputBuffer;
    try {
      inputBuffer = this.codec.getInputBuffer(index);
    } catch (Throwable e) {
      return;
    }
    if (inputBuffer == null) {
      return;
    }

    int sampleSize = extractor.readSampleData(inputBuffer, 0);
    if (sampleSize <= 0) {
      this.codec.queueInputBuffer(index, 0, 0, 0,
        MediaCodec.BUFFER_FLAG_END_OF_STREAM);
      return;
    }
    try {
      this.codec.queueInputBuffer(
        index,
        0,
        sampleSize,
        extractor.getSampleTime(),
        extractor.getSampleFlags()
      );
    } catch (Throwable e) {
      return;
    }
    extractor.advance();
    inputEOS = extractor.getSampleTime() == -1;
  }

  @Override
  synchronized public void onOutputBufferAvailable(
    @NonNull MediaCodec codec, int index, @NonNull MediaCodec.BufferInfo info) {
    if (released || droppingStaleCallbacks) {
      return;
    }
    boolean outputEOS = (info.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0;
    boolean sampleOutOfBounds =
      info.presentationTimeUs > TimeHelpers.secToUs(item.getStartTime() + item.getDuration());
    boolean sampleBeforeStartTime =
      info.presentationTimeUs < TimeHelpers.secToUs(item.getStartTime());

    if (!itemEndReached && info.size != 0 && !sampleOutOfBounds && !sampleBeforeStartTime) {
      ByteBuffer buffer;
      try {
        buffer = this.codec.getOutputBuffer(index);
      } catch (Throwable e) {
        return;
      }
      if (buffer == null) {
        return;
      }
      buffer.position(info.offset);
      buffer.limit(info.offset + info.size);

      Frame frame = getFreeFrame();
      frame.outputBufferIndex = index;
      frame.presentationTimeUs = info.presentationTimeUs;
      pendingFrames.add(frame);
      if (onFrameAvailableListener != null) {
        onFrameAvailableListener.onFrameAvailable(frame.presentationTimeUs);
      }
    } else {
      try {
        codec.releaseOutputBuffer(index, false);
      } catch (Throwable e) {
        return;
      }
    }

    itemEndReached = outputEOS || sampleOutOfBounds;
    if (itemEndReached) {
      if (onEndReachedListener != null) {
        onEndReachedListener.onEndReached();
      }
    }
  }

  @Override
  public void onError(@NonNull MediaCodec codec, @NonNull MediaCodec.CodecException e) {
    if (released) {
      return;
    }
    if (onErrorListener != null) {
      onErrorListener.onError(e);
    }
  }

  @Override
  public void onOutputFormatChanged(@NonNull MediaCodec codec, @NonNull MediaFormat format) {
    // Do nothing
  }

  synchronized public Long render(long compositionTimeUs) {
    if (pendingFrames.isEmpty()) {
      return null;
    }
    long compositionStartTimeUs = TimeHelpers.secToUs(item.getCompositionStartTime());
    long startTimeUs = TimeHelpers.secToUs(item.getStartTime());

    List<Frame> framesToRenders = new ArrayList<>();
    for (Frame frame : pendingFrames) {
      if (frame.presentationTimeUs - startTimeUs <= compositionTimeUs - compositionStartTimeUs || !hasRenderedFrame) {
        framesToRenders.add(frame);
        hasRenderedFrame = true;
      }
    }
    if (framesToRenders.isEmpty()) {
      return null;
    }
    // Only the latest is drawn: after a seek the batch runs from the previous
    // key frame, and drawing each one into the surface is GPU work nobody sees.
    int lastIndex = framesToRenders.size() - 1;
    for (int i = 0; i <= lastIndex; i++) {
      try {
        codec.releaseOutputBuffer(framesToRenders.get(i).outputBufferIndex, i == lastIndex);
      } catch (Throwable e) {
        // A codec flushed or released meanwhile: the buffer is gone with it.
      }
    }
    freeFrames.addAll(framesToRenders);
    pendingFrames.removeAll(framesToRenders);

    return framesToRenders.get(framesToRenders.size() - 1).presentationTimeUs;
  }

  /**
   * Seek to a specific time in the video.
   *
   * @param time the position in the composition timeline, in microseconds
   */
  synchronized public void seekTo(long time) {
    freeFrames.addAll(pendingFrames);
    pendingFrames.clear();
    codec.flush();
    // Queued behind the callbacks from before the flush, and ahead of those
    // start() brings: they run on this handler's thread in order.
    if (callbackHandler != null) {
      droppingStaleCallbacks = true;
      long generation = ++flushGeneration;
      callbackHandler.post(() -> {
        synchronized (this) {
          if (flushGeneration == generation) {
            droppingStaleCallbacks = false;
          }
        }
      });
    }
    long itemTime = time - TimeHelpers.secToUs(item.getCompositionStartTime());
    long seekTime = TimeHelpers.secToUs(item.getStartTime()) + Math.max(itemTime, 0);
    extractor.seekTo(seekTime, MediaExtractor.SEEK_TO_PREVIOUS_SYNC);
    itemEndReached = false;
    hasRenderedFrame = false;
    inputEOS = false;
    if (started) {
      codec.start();
    }
  }

  /**
   * Release the decoder.
   */
  synchronized public void release() {
    if (!released) {
      released = true;
      if (extractor != null) {
        extractor.release();
      }
      if (codec != null) {
        codec.release();
        codec = null;
      }
    }
  }

  private synchronized void configure() {
    if (prepared && surface != null && !configured) {
      if (callbackHandler == null) {
        // Where MediaCodec would call back without a handler; seekTo posts to it.
        Looper looper = Looper.myLooper();
        callbackHandler = new Handler(looper != null ? looper : Looper.getMainLooper());
      }
      codec.setCallback(this, callbackHandler);
      codec.configure(format, surface, null, 0);
      configured = true;
    }
  }

  /**
   * The mime type to decode the track as. A Dolby Vision track on a device
   * without a Dolby Vision decoder is decoded as its base layer: HDR clips
   * from an iPhone are profile 8.4, Dolby Vision metadata over an HLG HEVC
   * stream any HEVC decoder plays; profile 9 is over AVC. Sets the format to
   * match.
   */
  private static String playableMime(MediaFormat format, String mime) {
    if (!MediaFormat.MIMETYPE_VIDEO_DOLBY_VISION.equals(mime)
      || new MediaCodecList(MediaCodecList.REGULAR_CODECS).findDecoderForFormat(format) != null) {
      return mime;
    }
    int profile = format.containsKey(MediaFormat.KEY_PROFILE)
      ? format.getInteger(MediaFormat.KEY_PROFILE) : -1;
    String base = profile == CodecProfileLevel.DolbyVisionProfileDvavSe
      || profile == CodecProfileLevel.DolbyVisionProfileDvavPer
      || profile == CodecProfileLevel.DolbyVisionProfileDvavPen
      ? MediaFormat.MIMETYPE_VIDEO_AVC
      : MediaFormat.MIMETYPE_VIDEO_HEVC;
    format.setString(MediaFormat.KEY_MIME, base);
    // The Dolby Vision profile and level mean nothing to the base decoder.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      format.removeKey(MediaFormat.KEY_PROFILE);
      format.removeKey(MediaFormat.KEY_LEVEL);
    }
    return base;
  }

  private static int selectTrack(MediaExtractor extractor) {
    int numTracks = extractor.getTrackCount();
    for (int i = 0; i < numTracks; i++) {
      MediaFormat format = extractor.getTrackFormat(i);
      String mime = format.getString(MediaFormat.KEY_MIME);
      if (mime != null && mime.startsWith("video/")) {
        return i;
      }
    }
    return -1;
  }

  private Frame getFreeFrame() {
    return freeFrames.empty() ? new Frame() : freeFrames.pop();
  }

  public interface OnErrorListener {
    void onError(Exception error);
  }

  public interface OnFrameAvailableListener {
    void onFrameAvailable(long presentationTimeUs);
  }

  public interface OnEndReachedListener {
    void onEndReached();
  }

  /**
   * A frame representing a decoded output buffer sample.
   */
  private static class Frame {
    private int outputBufferIndex;
    private long presentationTimeUs;
  }
}
