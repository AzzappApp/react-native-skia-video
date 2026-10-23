package com.azzapp.rnskv;

import android.media.MediaCodec;
import android.media.MediaCodecInfo;
import android.media.MediaFormat;
import android.media.MediaMuxer;
import android.util.Log;
import android.view.Surface;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.util.ArrayList;
import java.util.List;

/**
 * Helper class for encoding video (and the audio of the composition items,
 * if any). React Native Skia renders the frames straight into the encoder's
 * input surface, through a WebGPU canvas context (see {@link #getInputSurface}).
 */
public class VideoEncoder {

  private static final String TAG = "VideoEncoder";

  public static final String MIME_TYPE = "video/avc";    // H.264 Advanced Video Coding

  public static final int DEFAULT_I_FRAME_INTERVAL_SECONDS = 1;

  private final String outputPath;

  private final int width;

  private final int height;

  private final int frameRate;

  private final int bitRate;

  private final String encoderName;

  private final VideoComposition composition;

  private final int audioSampleRate;

  private final int audioChannelCount;

  private final int audioBitRate;

  private final boolean hasAudio;

  private MediaCodec encoder;

  private Surface inputSurface;

  private MediaMuxer muxer;

  private int trackIndex;

  private int audioTrackIndex;

  private boolean muxerStarted;

  private final MediaCodec.BufferInfo bufferInfo;

  private Thread audioThread;

  private volatile boolean audioCanceled = false;

  private volatile Exception audioException;

  private static final long AUDIO_TIMEOUT_MS = 30_000;

  private final List<PendingSample> pendingVideoSamples = new ArrayList<>();

  private final List<PendingSample> pendingAudioSamples = new ArrayList<>();

  /**
   * Creates a new VideoEncoder.
   *
   * @param outputPath the path to write the encoded video to
   * @param width      the width of the video
   * @param height     the height of the video
   * @param frameRate  the frame rate of the video
   * @param bitRate    the bit rate of the video
   * @param encoderName the name of the encoder to use, or null to use the default encoder
   * @param composition the composition being exported, used to encode the
   *                    audio of its audio-enabled items; can be null
   * @param audioSampleRate the sample rate of the exported audio track
   * @param audioChannelCount the number of channels of the exported audio track
   * @param audioBitRate the bit rate of the exported audio track
   */
  public VideoEncoder(
    String outputPath,
    int width,
    int height,
    int frameRate,
    int bitRate,
    String encoderName,
    VideoComposition composition,
    int audioSampleRate,
    int audioChannelCount,
    int audioBitRate
  ) {
    this.outputPath = outputPath;
    this.width = width;
    this.height = height;
    this.frameRate = frameRate;
    this.bitRate = bitRate;
    this.encoderName = encoderName;
    this.composition = composition;
    this.audioSampleRate = audioSampleRate;
    this.audioChannelCount = audioChannelCount;
    this.audioBitRate = audioBitRate;
    this.hasAudio = composition != null && composition.hasAudio();
    bufferInfo = new MediaCodec.BufferInfo();
  }

  private MediaCodec createEncoder() throws IOException {
    return encoderName != null
      ? MediaCodec.createByCodecName(encoderName)
      : MediaCodec.createEncoderByType(MIME_TYPE);
  }

  /**
   * @param asFastAsPossible whether the encoder encodes as fast as it can, as Media3's Transformer
   *                         configures its own, rather than in real time (KEY_PRIORITY) at the
   *                         frame rate of the video (KEY_OPERATING_RATE): an export asks for
   *                         frames faster than real time.
   */
  private MediaFormat createFormat(boolean asFastAsPossible) {
    MediaFormat format = MediaFormat.createVideoFormat(MIME_TYPE, width, height);
    format.setInteger(MediaFormat.KEY_COLOR_FORMAT,
      MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface);
    format.setInteger(MediaFormat.KEY_BIT_RATE, bitRate);
    format.setInteger(MediaFormat.KEY_FRAME_RATE, frameRate);
    format.setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, DEFAULT_I_FRAME_INTERVAL_SECONDS);
    if (asFastAsPossible) {
      format.setInteger(MediaFormat.KEY_PRIORITY, 1);
      // Above what any encoder reaches, without overflowing the computations of some
      // (Integer.MAX_VALUE does).
      format.setInteger(MediaFormat.KEY_OPERATING_RATE, 1000);
    }
    return format;
  }

  /**
   * Configures encoder and muxer state, and prepares the input Surface.
   */
  public void prepare() throws IOException {
    encoder = createEncoder();
    try {
      encoder.configure(createFormat(true), null, null, MediaCodec.CONFIGURE_FLAG_ENCODE);
    } catch (RuntimeException e) {
      Log.w(TAG, "The encoder rejected the export settings, configured without them", e);
      encoder.release();
      encoder = createEncoder();
      encoder.configure(createFormat(false), null, null, MediaCodec.CONFIGURE_FLAG_ENCODE);
    }

    inputSurface = encoder.createInputSurface();
    encoder.start();

    try {
      muxer = new MediaMuxer(outputPath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4);
    } catch (IOException ioe) {
      throw new RuntimeException("MediaMuxer creation failed", ioe);
    }

    trackIndex = -1;
    audioTrackIndex = -1;
    muxerStarted = false;

    if (hasAudio) {
      AudioCompositionExporter audioExporter = new AudioCompositionExporter(
        composition,
        audioSampleRate,
        audioChannelCount,
        audioBitRate,
        new AudioCompositionExporter.Sink() {
          @Override
          public void onAudioFormat(MediaFormat format) {
            synchronized (VideoEncoder.this) {
              if (muxer == null) {
                return;
              }
              audioTrackIndex = muxer.addTrack(format);
              maybeStartMuxer();
            }
          }

          @Override
          public void onAudioSample(ByteBuffer buffer, MediaCodec.BufferInfo info) {
            writeOrQueueSample(false, buffer, info);
          }
        },
        () -> audioCanceled
      );
      audioThread = new Thread(() -> {
        try {
          audioExporter.run();
        } catch (Exception e) {
          audioException = e;
        }
      }, "ReactNativeSkiaVideo-AudioExportThread");
      audioThread.start();
    }
  }

  /**
   * @return the surface the frames are rendered into: React Native WebGPU presents them to it,
   * each one stamped with its presentation time (see VideoEncoderHostObject's beginFrame)
   */
  public Surface getInputSurface() {
    return inputSurface;
  }

  /**
   * Writes the frames the encoder encoded so far, after a frame was presented to the input
   * surface.
   */
  public void endFrame() {
    // Fail fast if the audio pipeline died: the muxer cannot start without
    // the audio track and every video sample would pile up in
    // pendingVideoSamples until the end of the export.
    if (audioException != null) {
      throw new RuntimeException("Could not encode composition audio", audioException);
    }
    drainEncoder(false);
  }

  public void finishWriting() {
    drainEncoder(true);
    if (audioThread != null) {
      try {
        audioThread.join(AUDIO_TIMEOUT_MS);
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
        throw new RuntimeException("Interrupted while writing audio", e);
      }
      if (audioThread.isAlive()) {
        // release() cancels it.
        throw new RuntimeException("Could not encode composition audio in 30 seconds");
      }
      audioThread = null;
      if (audioException != null) {
        throw new RuntimeException("Could not encode composition audio", audioException);
      }
    }
  }

  /**
   * Starts the muxer once every track has been registered and flushes the
   * queued samples. Must be called with the monitor held.
   */
  private void maybeStartMuxer() {
    if (muxerStarted
      || trackIndex < 0
      || (hasAudio && audioTrackIndex < 0)) {
      return;
    }
    muxer.start();
    muxerStarted = true;
    for (PendingSample sample : pendingVideoSamples) {
      muxer.writeSampleData(trackIndex, sample.buffer, sample.bufferInfo);
    }
    pendingVideoSamples.clear();
    for (PendingSample sample : pendingAudioSamples) {
      muxer.writeSampleData(audioTrackIndex, sample.buffer, sample.bufferInfo);
    }
    pendingAudioSamples.clear();
  }

  /**
   * Writes a sample to the muxer, or queues it until the muxer has started.
   */
  private synchronized void writeOrQueueSample(
    boolean isVideo,
    ByteBuffer buffer,
    MediaCodec.BufferInfo info
  ) {
    if (muxer == null) {
      // Released: an audio thread that outlived release().
      return;
    }
    if (muxerStarted) {
      muxer.writeSampleData(isVideo ? trackIndex : audioTrackIndex, buffer, info);
      return;
    }
    ByteBuffer copy = ByteBuffer.allocateDirect(info.size);
    copy.put(buffer);
    copy.flip();
    MediaCodec.BufferInfo infoCopy = new MediaCodec.BufferInfo();
    infoCopy.set(0, info.size, info.presentationTimeUs, info.flags);
    (isVideo ? pendingVideoSamples : pendingAudioSamples)
      .add(new PendingSample(copy, infoCopy));
  }

  private static class PendingSample {
    final ByteBuffer buffer;
    final MediaCodec.BufferInfo bufferInfo;

    PendingSample(ByteBuffer buffer, MediaCodec.BufferInfo bufferInfo) {
      this.buffer = buffer;
      this.bufferInfo = bufferInfo;
    }
  }

  /**
   * Extracts all pending data from the encoder.
   *
   * @param endOfStream true if this is the end of the stream
   */
  private void drainEncoder(boolean endOfStream) {
    final int TIMEOUT_USEC = 10000;

    if (endOfStream) {
      encoder.signalEndOfInputStream();
    }

    while (true) {
      // Only wait for outputs at the end of the stream: after each frame, the
      // last call would block for the whole timeout once the available
      // outputs are drained (the next frames drain the later ones).
      int encoderStatus = encoder.dequeueOutputBuffer(
        bufferInfo, endOfStream ? TIMEOUT_USEC : 0);
      if (encoderStatus == MediaCodec.INFO_TRY_AGAIN_LATER) {
        // no output available yet
        if (!endOfStream) {
          break; // out of while
        }
      }
      if (encoderStatus == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
        // should happen before receiving buffers, and should only happen once
        if (trackIndex >= 0) {
          throw new RuntimeException("format changed twice");
        }
        synchronized (this) {
          trackIndex = muxer.addTrack(encoder.getOutputFormat());
          maybeStartMuxer();
        }
      } else if (encoderStatus < 0) {
        Log.w(TAG, "unexpected result from encoder.dequeueOutputBuffer: " + encoderStatus);
        // let's ignore it
      } else {
        ByteBuffer encodedData = encoder.getOutputBuffer(encoderStatus);
        if (encodedData == null) {
          throw new RuntimeException("encoderOutputBuffer " + encoderStatus + " was null");
        }

        if ((bufferInfo.flags & MediaCodec.BUFFER_FLAG_CODEC_CONFIG) != 0) {
          // The codec config data was pulled out and fed to the muxer when we got
          // the INFO_OUTPUT_FORMAT_CHANGED status.  Ignore it.
          bufferInfo.size = 0;
        }

        if (bufferInfo.size != 0) {
          // adjust the ByteBuffer values to match BufferInfo (not needed?)
          encodedData.position(bufferInfo.offset);
          encodedData.limit(bufferInfo.offset + bufferInfo.size);

          writeOrQueueSample(true, encodedData, bufferInfo);
        }

        encoder.releaseOutputBuffer(encoderStatus, false);

        if ((bufferInfo.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) {
          if (!endOfStream) {
            Log.w(TAG, "reached end of stream unexpectedly");
          }
          break; // out of while
        }
      }
    }
  }

  /**
   * Releases encoder resources.  May be called after partial / failed initialization.
   */
  public void release() {
    if (audioThread != null) {
      // Stop the audio pipeline before tearing down the muxer.
      audioCanceled = true;
      try {
        audioThread.join(5000);
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
      }
      audioThread = null;
    }
    if (encoder != null) {
      try {
        encoder.stop();
      } catch (IllegalStateException e) {
        // the encoder never started or is in an error state (failed or
        // canceled exports); release() below reclaims it anyway.
        Log.w(TAG, "Could not stop the encoder", e);
      }
      encoder.release();
      encoder = null;
    }
    if (inputSurface != null) {
      inputSurface.release();
      inputSurface = null;
    }
    // Under the monitor: the audio thread can outlive the join above, its
    // samples must not reach a released muxer.
    synchronized (this) {
      if (muxer != null) {
        try {
          muxer.stop();
        } catch (IllegalStateException e) {
          // the muxer never started or has no sample (failed exports).
          Log.w(TAG, "Could not stop the muxer", e);
        }
        muxer.release();
        muxer = null;
      }
      // Direct ByteBuffers only reclaim their native memory once the Java
      // object is collected; drop them eagerly.
      pendingVideoSamples.clear();
      pendingAudioSamples.clear();
    }
  }
}
