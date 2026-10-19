package com.azzapp.rnskv;

import android.media.MediaCodec;
import android.media.MediaCodecInfo;
import android.media.MediaCodecList;
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
 *
 * The decoder is only created while the item is live (see {@link #open} and {@link #close}): a
 * composition keeps the decoders, and their buffers, of the items around its current time.
 */
public class VideoCompositionItemDecoder extends MediaCodec.Callback {

  private final VideoComposition.Item item;

  private MediaExtractor extractor;

  private MediaCodec codec;

  private MediaFormat format;

  private String mime;

  private boolean inputEOS = false;

  private boolean hasRenderedFrame = false;

  private boolean itemEndReached = false;

  private int videoWidth;

  private int videoHeight;

  private int rotation;

  private boolean prepared = false;

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
   * Reads the format of the item. The decoder itself is created by {@link #open}.
   *
   * @throws IOException if the item cannot be read
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
    mime = format.getString(MediaFormat.KEY_MIME);
    if (mime == null) {
      throw new IOException("Could not determine file mime type");
    }
    videoWidth = format.getInteger(MediaFormat.KEY_WIDTH);
    videoHeight = format.getInteger(MediaFormat.KEY_HEIGHT);
    extractor.selectTrack(trackIndex);
    rotation = format.containsKey(MediaFormat.KEY_ROTATION) ? format.getInteger(MediaFormat.KEY_ROTATION) : 0;
    prepared = true;
  }

  /**
   * Creates and starts the decoder, decoding from the given position of the composition, unless
   * it is open. Its callbacks run on the looper of the calling thread.
   *
   * @param compositionTimeUs the position in the composition timeline, in microseconds
   * @throws IOException if the decoder cannot be created
   */
  synchronized public void open(long compositionTimeUs) throws IOException {
    if (!prepared || released || codec != null || surface == null) {
      return;
    }
    MediaCodec codec = createCodec();
    try {
      codec.setCallback(this);
      codec.configure(format, surface, null, 0);
      this.codec = codec;
      seekExtractor(compositionTimeUs);
      codec.start();
    } catch (RuntimeException e) {
      this.codec = null;
      codec.release();
      throw e;
    }
  }

  /**
   * Releases the decoder, the item's format is kept: {@link #open} creates another one.
   */
  synchronized public void close() {
    if (codec == null) {
      return;
    }
    // Before the release: the callbacks it leaves queued see a decoder that is no longer this one.
    MediaCodec codec = this.codec;
    this.codec = null;
    codec.release();
    freeFrames.addAll(pendingFrames);
    pendingFrames.clear();
  }

  /**
   * @return whether the decoder is open (see {@link #open})
   */
  synchronized public boolean isOpen() {
    return codec != null;
  }

  private MediaCodec createCodec() throws IOException {
    // createDecoderByType always returns the first decoder for the mime type
    // (usually the hardware one) even when it can't handle the stream, e.g. a
    // 1080x2048 portrait video on a decoder capped at 1920x1088. Only then,
    // pick one that supports the actual format: hardware decoders often
    // under-report the frame rates and levels they decode, for which
    // findDecoderForFormat would pick a (much slower) software decoder.
    MediaCodec codec = MediaCodec.createDecoderByType(mime);
    boolean sizeSupported = true;
    try {
      MediaCodecInfo.VideoCapabilities capabilities =
        codec.getCodecInfo().getCapabilitiesForType(mime).getVideoCapabilities();
      sizeSupported = capabilities == null
        || capabilities.isSizeSupported(videoWidth, videoHeight);
    } catch (IllegalArgumentException e) {
      // Unknown capabilities: keep the default decoder.
    }
    if (!sizeSupported) {
      String decoderName = new MediaCodecList(MediaCodecList.REGULAR_CODECS)
        .findDecoderForFormat(format);
      if (decoderName != null) {
        codec.release();
        codec = MediaCodec.createByCodecName(decoderName);
      }
    }
    return codec;
  }

  /**
   * Set the surface to render the video to, before the decoder is opened.
   *
   * @param surface the surface to render the video to
   */
  synchronized public void setSurface(Surface surface) {
    this.surface = surface;
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
    // A callback left queued by a closed decoder.
    if (released || codec != this.codec) {
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
    if (released || codec != this.codec) {
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
    synchronized (this) {
      if (released || codec != this.codec) {
        return;
      }
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
    if (codec == null || pendingFrames.isEmpty()) {
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
    // Only the latest frame is rendered to the surface, the earlier ones are
    // dropped: they are already outdated, and the frame extractor would still
    // draw each of them into a frame buffer.
    Frame latestFrame = framesToRenders.get(framesToRenders.size() - 1);
    framesToRenders.forEach(frame -> {
      try {
        codec.releaseOutputBuffer(frame.outputBufferIndex, frame == latestFrame);
      } catch (Throwable e) {
        return;
      }
    });
    freeFrames.addAll(framesToRenders);
    pendingFrames.removeAll(framesToRenders);

    return latestFrame.presentationTimeUs;
  }

  /**
   * Seek to a specific time in the video.
   *
   * @param time the position in the composition timeline, in microseconds
   */
  synchronized public void seekTo(long time) {
    // A closed decoder is positioned when it is opened.
    if (codec == null) {
      return;
    }
    freeFrames.addAll(pendingFrames);
    pendingFrames.clear();
    codec.flush();
    seekExtractor(time);
    codec.start();
  }

  /**
   * Positions the extractor at the given position of the composition, and resets the decoding.
   */
  private void seekExtractor(long time) {
    long itemTime = time - TimeHelpers.secToUs(item.getCompositionStartTime());
    long seekTime = TimeHelpers.secToUs(item.getStartTime()) + Math.max(itemTime, 0);
    extractor.seekTo(seekTime, MediaExtractor.SEEK_TO_PREVIOUS_SYNC);
    itemEndReached = false;
    hasRenderedFrame = false;
    inputEOS = false;
  }

  /**
   * Release the decoder.
   */
  synchronized public void release() {
    if (!released) {
      close();
      released = true;
      if (extractor != null) {
        extractor.release();
      }
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
