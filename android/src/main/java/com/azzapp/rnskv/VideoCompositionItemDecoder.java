package com.azzapp.rnskv;

import android.media.MediaCodec;
import android.media.MediaExtractor;
import android.media.MediaFormat;
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

  private boolean released = false;

  private Surface surface;

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
    codec = MediaCodec.createDecoderByType(mime);
    extractor.selectTrack(trackIndex);
    if (item.getStartTime() != 0) {
      extractor.seekTo(
        TimeHelpers.secToUs(item.getStartTime()), MediaExtractor.SEEK_TO_PREVIOUS_SYNC);
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
    if (!prepared || !configured || released) {
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
    if (released) {
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
      if (frame.presentationTimeUs - startTimeUs < compositionTimeUs - compositionStartTimeUs || !hasRenderedFrame) {
        framesToRenders.add(frame);
        hasRenderedFrame = true;
      }
    }
    if (framesToRenders.isEmpty()) {
      return null;
    }
    framesToRenders.forEach(frame -> {
      try {
        codec.releaseOutputBuffer(frame.outputBufferIndex, true);
      } catch (Throwable e) {
        return;
      }
    });
    freeFrames.addAll(framesToRenders);
    pendingFrames.removeAll(framesToRenders);

    return framesToRenders.get(framesToRenders.size() - 1).presentationTimeUs;
  }

  /**
   * Seek to a specific time in the video.
   *
   * @param time the time in microseconds to seek to
   */
  synchronized public void seekTo(long time) {
    pendingFrames.clear();
    codec.flush();
    long seekTime = time + TimeHelpers.secToUs(item.getStartTime());
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
      codec.setCallback(this);
      codec.configure(format, surface, null, 0);
      configured = true;
    }
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
