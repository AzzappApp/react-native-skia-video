package com.azzapp.rnskv;

import android.media.MediaCodec;
import android.media.MediaCodecInfo;
import android.media.MediaCodecList;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.os.Build;
import android.os.Handler;
import android.util.Log;
import android.view.Surface;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

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

  private boolean started = false;

  // Whether open() is creating the decoder, outside of the lock.
  private boolean opening = false;

  private boolean released = false;

  private Surface surface;

  private final Stack<Frame> freeFrames = new Stack<>();

  private final List<Frame> pendingFrames = new ArrayList<>();

  private OnErrorListener onErrorListener;

  private OnEndReachedListener onEndReachedListener;

  private OnFrameAvailableListener onFrameAvailableListener;

  private static final String TAG = "VideoCompositionItemDecoder";

  /**
   * The operating rate of an export's decoders (see {@link #getExportFormat}): above what any
   * decoder reaches, without overflowing the computations of some (Integer.MAX_VALUE does).
   */
  private static final int EXPORT_OPERATING_RATE = 1000;

  // Whether the decoder decodes for an export rather than a preview.
  private final boolean forExport;

  // Whether the codec rejected the export settings (see getExportFormat): not tried again.
  private boolean exportSettingsRejected = false;

  /**
   * Create a new VideoCompositionItemDecoder.
   *
   * @param item      the video composition item to decode
   * @param forExport whether it decodes for an export, as fast as it can, rather than in real time
   */
  public VideoCompositionItemDecoder(VideoComposition.Item item, boolean forExport) {
    this.item = item;
    this.forExport = forExport;
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
   * Creates the decoder, to decode from the given position of the composition once started (see
   * {@link #start}), unless it is open.
   *
   * Creating, starting and releasing a decoder take tens of milliseconds: they are done outside of
   * the lock that {@link #render} and the decoder's callbacks take.
   *
   * @param compositionTimeUs the position in the composition timeline, in microseconds
   * @param callbackHandler   the handler the decoder's callbacks run on, or null for the looper of
   *                          the calling thread
   * @return whether the decoder was created
   * @throws IOException if the decoder cannot be created
   */
  public boolean open(long compositionTimeUs, @Nullable Handler callbackHandler)
    throws IOException {
    Surface surface;
    synchronized (this) {
      if (!prepared || released || codec != null || opening || this.surface == null) {
        return false;
      }
      opening = true;
      surface = this.surface;
    }
    MediaCodec codec;
    try {
      codec = createCodec();
      MediaFormat exportFormat = getExportFormat();
      if (exportFormat == null) {
        configure(codec, format, surface, callbackHandler);
      } else {
        try {
          configure(codec, exportFormat, surface, callbackHandler);
        } catch (RuntimeException e) {
          Log.w(TAG, "The decoder rejected the export settings, configured without them", e);
          exportSettingsRejected = true;
          codec = createCodec();
          configure(codec, format, surface, callbackHandler);
        }
      }
    } catch (IOException | RuntimeException e) {
      synchronized (this) {
        opening = false;
      }
      throw e;
    }
    synchronized (this) {
      opening = false;
      if (!released) {
        this.codec = codec;
        seekExtractor(compositionTimeUs);
        return true;
      }
    }
    // Released meanwhile.
    codec.release();
    return false;
  }

  /**
   * Starts decoding, once the decoder is open.
   */
  public void start() {
    MediaCodec codec;
    synchronized (this) {
      if (this.codec == null || started) {
        return;
      }
      codec = this.codec;
      started = true;
    }
    try {
      codec.start();
    } catch (RuntimeException e) {
      throw describeError("start", e);
    }
  }

  /**
   * An error of the decoder, with its item and, for a CodecException (which has no message), the
   * codec's own diagnostic.
   */
  private RuntimeException describeError(String action, RuntimeException e) {
    String details = e.getMessage();
    if (e instanceof MediaCodec.CodecException) {
      MediaCodec.CodecException codecException = (MediaCodec.CodecException) e;
      details = codecException.getDiagnosticInfo()
        + ", error code " + codecException.getErrorCode()
        + (codecException.isTransient() ? ", transient" : "");
    }
    return new RuntimeException(
      "Could not " + action + " the decoder of the item " + item.getId() + ": " + details, e);
  }

  /**
   * Releases the decoder, the item's format is kept: {@link #open} creates another one.
   */
  public void close() {
    MediaCodec codec;
    synchronized (this) {
      if (this.codec == null) {
        return;
      }
      // Before the release: the callbacks it leaves queued see a decoder that is no longer this
      // one.
      codec = this.codec;
      this.codec = null;
      started = false;
      freeFrames.addAll(pendingFrames);
      pendingFrames.clear();
    }
    codec.release();
  }

  /**
   * @return whether the decoder is open (see {@link #open})
   */
  synchronized public boolean isOpen() {
    return codec != null;
  }

  /**
   * The format an export's decoder is configured with: decoding as fast as it can, rather than in
   * real time (KEY_PRIORITY) at the frame rate of the video (KEY_OPERATING_RATE). Configured for
   * real time, a decoder was clocked for 30 fps while the export asked for 40. Null for a preview,
   * or once the decoder rejected it.
   */
  @Nullable
  private MediaFormat getExportFormat() {
    if (!forExport || exportSettingsRejected || Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
      return null;
    }
    // A copy: createCodec looks a decoder up with the item's own format.
    MediaFormat exportFormat = new MediaFormat(format);
    exportFormat.setInteger(MediaFormat.KEY_PRIORITY, 1);
    exportFormat.setInteger(MediaFormat.KEY_OPERATING_RATE, EXPORT_OPERATING_RATE);
    return exportFormat;
  }

  /**
   * Configures the codec, released if it cannot be.
   */
  private void configure(
    MediaCodec codec, MediaFormat format, Surface surface, @Nullable Handler callbackHandler) {
    try {
      codec.setCallback(this, callbackHandler);
      codec.configure(format, surface, null, 0);
    } catch (RuntimeException e) {
      codec.release();
      throw describeError("configure", e);
    }
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
    if (!started) {
      seekExtractor(time);
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
  public void release() {
    synchronized (this) {
      if (released) {
        return;
      }
      // The callbacks of the decoder no longer read the extractor.
      released = true;
    }
    close();
    synchronized (this) {
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
