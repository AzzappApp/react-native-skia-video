package com.azzapp.rnskv;

import android.graphics.Bitmap;
import android.media.MediaCodec;
import android.media.MediaCodecInfo;
import android.media.MediaFormat;
import android.media.MediaMuxer;
import android.opengl.GLES20;
import android.util.Log;
import android.view.Surface;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.util.ArrayList;
import java.util.List;

import javax.microedition.khronos.egl.EGL10;
import javax.microedition.khronos.egl.EGLContext;


/**
 * Helper class for encoding video (and the audio of the composition items,
 * if any).
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

  private EGLResourcesHolder eglResourcesHolder;

  private TextureRenderer textureRenderer;

  private MediaMuxer muxer;

  private int trackIndex;

  private int audioTrackIndex;

  private boolean muxerStarted;

  private final MediaCodec.BufferInfo bufferInfo;

  private Thread audioThread;

  private volatile boolean audioCanceled = false;

  private volatile Exception audioException;

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

  /**
   * Configures encoder and muxer state, and prepares the input Surface.
   */
  public void prepare() throws IOException {
    EGLContext sharedContext = EGLUtils.getCurrentContextOrThrows();
    encoder = encoderName != null
      ? MediaCodec.createByCodecName(encoderName)
      : MediaCodec.createEncoderByType(MIME_TYPE);

    MediaFormat format = MediaFormat.createVideoFormat(MIME_TYPE, width, height);
    format.setInteger(MediaFormat.KEY_COLOR_FORMAT,
      MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface);
    format.setInteger(MediaFormat.KEY_BIT_RATE, bitRate);
    format.setInteger(MediaFormat.KEY_FRAME_RATE, frameRate);
    format.setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, DEFAULT_I_FRAME_INTERVAL_SECONDS);

    encoder.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE);

    inputSurface = encoder.createInputSurface();
    eglResourcesHolder = EGLResourcesHolder.createWithWindowedSurface(sharedContext, inputSurface);
    eglResourcesHolder.makeCurrent();
    textureRenderer = new TextureRenderer();
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

  public void makeGLContextCurrent() {
    eglResourcesHolder.makeCurrent();
  }

  public void encodeFrame(int texture, double time) {
    // Fail fast if the audio pipeline died: the muxer cannot start without
    // the audio track and every video sample would pile up in
    // pendingVideoSamples until the end of the export.
    if (audioException != null) {
      throw new RuntimeException("Could not encode composition audio", audioException);
    }
    long timeUS = TimeHelpers.secToUs(time);
    GLES20.glClearColor(0, 0, 0, 0);
    GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT);
    GLES20.glViewport(0, 0, width, height);
    textureRenderer.draw(texture, EGLUtils.IDENTITY_MATRIX);
    eglResourcesHolder.setPresentationTime(timeUS * 1000);
    if (!eglResourcesHolder.swapBuffers()) {
      throw new RuntimeException("eglSwapBuffer failed");
    }
    drainEncoder(false);
  }

  public void finishWriting() {
    drainEncoder(true);
    if (audioThread != null) {
      try {
        audioThread.join();
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
        throw new RuntimeException("Interrupted while writing audio", e);
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
      int encoderStatus = encoder.dequeueOutputBuffer(bufferInfo, TIMEOUT_USEC);
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
    if (eglResourcesHolder != null) {
      eglResourcesHolder.release();
    }
    if (encoder != null) {
      encoder.stop();
      encoder.release();
      encoder = null;
    }
    if (inputSurface != null) {
      inputSurface.release();
      inputSurface = null;
    }
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
  }

  public Bitmap saveTexture(int texture, int width, int height) {
    int[] frame = new int[1];
    GLES20.glGenFramebuffers(1, frame, 0);
    GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, frame[0]);
    GLES20.glFramebufferTexture2D(
      GLES20.GL_FRAMEBUFFER,
      GLES20.GL_COLOR_ATTACHMENT0, GLES20.GL_TEXTURE_2D, texture,
      0
    );

    ByteBuffer buffer = ByteBuffer.allocate(width * height * 4);
    GLES20.glReadPixels(
      0, 0, width, height, GLES20.GL_RGBA,
      GLES20.GL_UNSIGNED_BYTE, buffer
    );

    Bitmap bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
    bitmap.copyPixelsFromBuffer(buffer);

    GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, 0);
    GLES20.glDeleteFramebuffers(1, frame, 0);

    return bitmap;
  }
}
