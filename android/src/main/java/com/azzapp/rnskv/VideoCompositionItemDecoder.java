package com.azzapp.rnskv;

import android.media.MediaCodec;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.util.Log;
import android.view.Surface;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.util.Stack;

/**
 * A class that decodes a video item from a video composition.
 */
public class VideoCompositionItemDecoder {

  private VideoComposition.Item item;

  private MediaExtractor extractor;

  private MediaCodec decoder;

  private MediaFormat format;

  private MediaCodec.BufferInfo bufferInfo;

  private long inputSamplePresentationTimeUS = 0;

  private Boolean inputEOS = false;

  private long outputPresentationTimeTimeUS = 0;

  private Boolean outputEOS = false;

  private int videoWidth;

  private int videoHeight;

  private int rotation;

  private Boolean prepared = false;

  private Boolean configured = false;

  private Surface surface;

  /**
   * Create a new VideoCompositionItemDecoder.
   * @param item the video composition item to decode
   */
  public VideoCompositionItemDecoder(VideoComposition.Item item) {
    this.item = item;
  }

  /**
   * Prepare the decoder.
   * @throws IOException if the decoder cannot be prepared
   */
  public void prepare() throws IOException {
    extractor = new MediaExtractor();
    extractor.setDataSource(item.getPath());
    int trackIndex = selectTrack(extractor);
    if (trackIndex == -1) {
      throw new RuntimeException("No video track");
    }
    format = extractor.getTrackFormat(trackIndex);
    String mime = format.getString(MediaFormat.KEY_MIME);
    decoder = MediaCodec.createDecoderByType(mime);
    extractor.selectTrack(trackIndex);
    videoWidth = format.getInteger(MediaFormat.KEY_WIDTH);
    videoHeight = format.getInteger(MediaFormat.KEY_HEIGHT);
    rotation = format.containsKey(MediaFormat.KEY_ROTATION) ? format.getInteger(MediaFormat.KEY_ROTATION) : 0;
    bufferInfo = new MediaCodec.BufferInfo();
    prepared = true;
    configure();
  }

  /**
   * Set the surface to render the video to.
   * @param surface the surface to render the video to
   */
  public void setSurface(Surface surface) {
    this.surface = surface;
    configure();
  }

  private synchronized void configure() {
    if (prepared && surface != null && !configured) {
      decoder.configure(format, surface, null, 0);
      decoder.start();
      configured = true;
    }
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

  /**
   * @return true if the output buffer reached the end of stream
   */
  public boolean isOutputEOS() {
    return outputEOS;
  }

  /**
   * @return the presentation time of the output buffer in microseconds
   */
  public long getOutputPresentationTimeTimeUS() {
    return outputPresentationTimeTimeUS;
  }

  /**
   * @return the presentation time of the input sample in microseconds
   */
  public long getInputSamplePresentationTimeUS() {
    return inputSamplePresentationTimeUS;
  }

  /**
   * Seek to a specific time in the video.
   * @param time the time in microseconds to seek to
   */
  public void seekTo(long time) {
    extractor.seekTo(time, MediaExtractor.SEEK_TO_PREVIOUS_SYNC);
    decoder.flush();
    inputSamplePresentationTimeUS = time;
    outputPresentationTimeTimeUS = -1;
    outputEOS = false;
    inputEOS = false;
  }

  private static final int TIMEOUT_US = 0;

  /**
   * Queue a sample to the codec.
   */
  public boolean queueSampleToCodec() {
    if(inputEOS || !prepared || !configured) {
      return false;
    }

    int inputBufIndex = decoder.dequeueInputBuffer(TIMEOUT_US);
    if (inputBufIndex < 0) {
      return false;
    }
    boolean sampleQueued = false;
    ByteBuffer inputBuffer = decoder.getInputBuffer(inputBufIndex);
    int sampleSize = extractor.readSampleData(inputBuffer, 0);
    long presentationTimeUs = 0;

    if (sampleSize < 0) {
      inputEOS = true;
      sampleSize = 0;
    } else {
      presentationTimeUs = extractor.getSampleTime();
      sampleQueued = true;
    }

    decoder.queueInputBuffer(
      inputBufIndex,
      0,
      sampleSize,
      presentationTimeUs,
      inputEOS ? MediaCodec.BUFFER_FLAG_END_OF_STREAM : 0
    );

    inputSamplePresentationTimeUS = presentationTimeUs;
    if (!inputEOS) {
      extractor.advance();
    }
    return sampleQueued;
  }

  /**
   * Dequeue the output buffer, optionally forcing the dequeue
   * @return the frame representing the decoded output buffer sample or null if no output buffer is ready
   */
  public Frame dequeueOutputBuffer() {
    if (outputEOS || !prepared || !configured) {
      return null;
    }
    int outputBufferIndex = decoder.dequeueOutputBuffer(bufferInfo, TIMEOUT_US);
    outputEOS = outputBufferIndex >= 0 && (bufferInfo.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0;
    if (outputBufferIndex < 0) {
      if (outputBufferIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
        return dequeueOutputBuffer();
      }
      return null;
    }
    outputPresentationTimeTimeUS = bufferInfo.presentationTimeUs;
    Frame frame = getFreeFrame();
    frame.outputBufferIndex = outputBufferIndex;
    frame.presentationTimeUs = outputPresentationTimeTimeUS;
    frame.decoder = this;
    frame.released = false;
    return frame;
  }

  private final Stack<Frame> freeFrames = new Stack<>();

  private Frame getFreeFrame() {
    return freeFrames.empty() ? new Frame() : freeFrames.pop();
  }

  private void renderFrame(Frame frame) {
    decoder.releaseOutputBuffer(frame.outputBufferIndex, true);
    freeFrames.add(frame);
  }

  private void releaseFrame(Frame frame) {
    decoder.releaseOutputBuffer(frame.outputBufferIndex, false);
    freeFrames.add(frame);
  }

  /**
   * Release the decoder.
   */
  public void release() {
    if (extractor != null) {
      extractor.release();
    }
    if (decoder != null) {
      decoder.release();
    }
  }

  private static int selectTrack(MediaExtractor extractor) {
    // Select the first video track we find, ignore the rest.
    int numTracks = extractor.getTrackCount();
    for (int i = 0; i < numTracks; i++) {
      MediaFormat format = extractor.getTrackFormat(i);
      String mime = format.getString(MediaFormat.KEY_MIME);
      if (mime.startsWith("video/")) {
        return i;
      }
    }
    return -1;
  }

  /**
   * A frame representing a decoded output buffer sample.
   */
  public static class Frame {
    private int outputBufferIndex;

    private long presentationTimeUs;

    private VideoCompositionItemDecoder decoder;

    private boolean released = false;

    /**
     * @return the presentation time of the frame in microseconds
     */
    public long getPresentationTimeUs() {
      return presentationTimeUs;
    }

    /**
     * Render the frame to the surface associated with the decoder.
     */
    public void render() {
      if (released) {
        throw new RuntimeException("Trying to render 2 time the same frame");
      }
      decoder.renderFrame(this);
      released = true;
    }

    /**
     * Release the frame without rendering it.
     */
    public void release() {
      if (!released) {
        decoder.releaseFrame(this);
        released = true;
      }
    }
  }
}
