package com.azzapp.rnskv;

import android.media.MediaCodec;
import android.media.MediaCodecInfo;
import android.media.MediaExtractor;
import android.media.MediaFormat;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.ShortBuffer;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.function.BooleanSupplier;

/**
 * Decodes, mixes and encodes (AAC) the audio of the audio-enabled items of a
 * video composition. The pipeline is synchronous and meant to be run on a
 * dedicated thread, in parallel of the video frames encoding.
 */
public class AudioCompositionExporter {

  public static final String AUDIO_MIME_TYPE = "audio/mp4a-latm";

  private static final int CHUNK_FRAMES = 2048;

  private static final long CODEC_TIMEOUT_US = 10000;

  private static final int MAX_STALLED_ITERATIONS = 1000;

  /**
   * Receives the encoded AAC samples, on the thread running {@link #run}.
   */
  public interface Sink {
    void onAudioFormat(MediaFormat format);

    void onAudioSample(ByteBuffer buffer, MediaCodec.BufferInfo bufferInfo);
  }

  private final VideoComposition composition;

  private final int sampleRate;

  private final int channelCount;

  private final int bitRate;

  private final Sink sink;

  private final BooleanSupplier isCanceled;

  private MediaCodec encoder;

  private final MediaCodec.BufferInfo encoderBufferInfo = new MediaCodec.BufferInfo();

  private boolean formatDispatched = false;

  public AudioCompositionExporter(
    VideoComposition composition,
    int sampleRate,
    int channelCount,
    int bitRate,
    Sink sink,
    BooleanSupplier isCanceled
  ) {
    this.composition = composition;
    this.sampleRate = sampleRate;
    this.channelCount = channelCount;
    this.bitRate = bitRate;
    this.sink = sink;
    this.isCanceled = isCanceled;
  }

  /**
   * Runs the whole audio export pipeline, returns once every audio sample
   * of the composition has been encoded and handed to the sink.
   */
  public void run() throws Exception {
    List<ItemSlot> slots = new ArrayList<>();
    try {
      for (VideoComposition.Item item : composition.getItems()) {
        if (!item.isAudioEnabled()) {
          continue;
        }
        slots.add(new ItemSlot(item));
      }

      encoder = MediaCodec.createEncoderByType(AUDIO_MIME_TYPE);
      MediaFormat format =
        MediaFormat.createAudioFormat(AUDIO_MIME_TYPE, sampleRate, channelCount);
      format.setInteger(
        MediaFormat.KEY_AAC_PROFILE,
        MediaCodecInfo.CodecProfileLevel.AACObjectLC
      );
      format.setInteger(MediaFormat.KEY_BIT_RATE, bitRate);
      encoder.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE);
      encoder.start();

      long totalFrames = Math.round(composition.getDuration() * sampleRate);
      int[] mixBuffer = new int[CHUNK_FRAMES * channelCount];
      long framePosition = 0;
      while (framePosition < totalFrames) {
        if (isCanceled.getAsBoolean()) {
          return;
        }
        int chunkFrames = (int) Math.min(CHUNK_FRAMES, totalFrames - framePosition);
        long chunkEndFrame = framePosition + chunkFrames;
        Arrays.fill(mixBuffer, 0);
        for (ItemSlot slot : slots) {
          if (slot.done || chunkEndFrame <= slot.startFrame) {
            continue;
          }
          // Decoders are created when the timeline enters the item and
          // released when it leaves it, so the number of simultaneous
          // codec instances stays bounded by the overlapping items.
          if (slot.decoder == null) {
            slot.decoder = new ItemDecoder(slot.item);
          }
          slot.decoder.mixInto(mixBuffer, framePosition, chunkFrames);
          if (chunkEndFrame >= slot.endFrame) {
            slot.decoder.release();
            slot.decoder = null;
            slot.done = true;
          }
        }
        queuePcm(mixBuffer, chunkFrames, framePosition);
        framePosition += chunkFrames;
      }
      queueEndOfStream();
    } finally {
      for (ItemSlot slot : slots) {
        if (slot.decoder != null) {
          slot.decoder.release();
        }
      }
      if (encoder != null) {
        try {
          encoder.stop();
        } catch (IllegalStateException ignored) {
        }
        encoder.release();
        encoder = null;
      }
    }
  }

  private void queuePcm(int[] samples, int frames, long framePosition) {
    int bytesPerFrame = channelCount * 2;
    int totalBytes = frames * bytesPerFrame;
    int offsetBytes = 0;
    int stalled = 0;
    while (offsetBytes < totalBytes) {
      int inputIndex = encoder.dequeueInputBuffer(CODEC_TIMEOUT_US);
      if (inputIndex < 0) {
        drainEncoder(false);
        if (++stalled > MAX_STALLED_ITERATIONS) {
          throw new RuntimeException("Audio encoder stalled");
        }
        continue;
      }
      stalled = 0;
      ByteBuffer input = encoder.getInputBuffer(inputIndex);
      if (input == null) {
        throw new RuntimeException("Audio encoder input buffer was null");
      }
      input.clear();
      input.order(ByteOrder.LITTLE_ENDIAN);
      int bytes = Math.min(input.remaining(), totalBytes - offsetBytes);
      bytes -= bytes % bytesPerFrame;
      ShortBuffer shortBuffer = input.asShortBuffer();
      int sampleOffset = offsetBytes / 2;
      int sampleCount = bytes / 2;
      for (int i = 0; i < sampleCount; i++) {
        int sample = samples[sampleOffset + i];
        shortBuffer.put(
          (short) Math.max(Short.MIN_VALUE, Math.min(Short.MAX_VALUE, sample)));
      }
      long ptsUs =
        (framePosition + offsetBytes / bytesPerFrame) * 1000000L / sampleRate;
      encoder.queueInputBuffer(inputIndex, 0, bytes, ptsUs, 0);
      offsetBytes += bytes;
      drainEncoder(false);
    }
  }

  private void queueEndOfStream() {
    int stalled = 0;
    while (true) {
      int inputIndex = encoder.dequeueInputBuffer(CODEC_TIMEOUT_US);
      if (inputIndex >= 0) {
        encoder.queueInputBuffer(
          inputIndex, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM);
        break;
      }
      drainEncoder(false);
      if (++stalled > MAX_STALLED_ITERATIONS) {
        throw new RuntimeException("Audio encoder stalled");
      }
    }
    drainEncoder(true);
  }

  private void drainEncoder(boolean endOfStream) {
    while (true) {
      int encoderStatus =
        encoder.dequeueOutputBuffer(encoderBufferInfo, endOfStream ? CODEC_TIMEOUT_US : 0);
      if (encoderStatus == MediaCodec.INFO_TRY_AGAIN_LATER) {
        if (!endOfStream) {
          break;
        }
      } else if (encoderStatus == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
        if (formatDispatched) {
          throw new RuntimeException("Audio format changed twice");
        }
        formatDispatched = true;
        sink.onAudioFormat(encoder.getOutputFormat());
      } else if (encoderStatus >= 0) {
        ByteBuffer encodedData = encoder.getOutputBuffer(encoderStatus);
        if (encodedData == null) {
          throw new RuntimeException(
            "audioEncoderOutputBuffer " + encoderStatus + " was null");
        }
        if ((encoderBufferInfo.flags & MediaCodec.BUFFER_FLAG_CODEC_CONFIG) != 0) {
          encoderBufferInfo.size = 0;
        }
        if (encoderBufferInfo.size != 0) {
          encodedData.position(encoderBufferInfo.offset);
          encodedData.limit(encoderBufferInfo.offset + encoderBufferInfo.size);
          sink.onAudioSample(encodedData, encoderBufferInfo);
        }
        encoder.releaseOutputBuffer(encoderStatus, false);
        if ((encoderBufferInfo.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) {
          break;
        }
      }
    }
  }

  /**
   * An audio-enabled item of the composition and its decoder; the decoder
   * only exists while the export timeline overlaps the item.
   */
  private class ItemSlot {
    final VideoComposition.Item item;
    final long startFrame;
    final long endFrame;
    ItemDecoder decoder;
    boolean done = false;

    ItemSlot(VideoComposition.Item item) {
      this.item = item;
      startFrame = Math.round(item.getCompositionStartTime() * sampleRate);
      endFrame = startFrame + Math.round(item.getDuration() * sampleRate);
    }
  }

  /**
   * Decodes the audio track of a composition item, resampled to the output
   * sample rate/channel count, and mixes it into the composition timeline.
   */
  private class ItemDecoder {

    private final long itemStartFrame;

    private final long itemEndFrame;

    private final double volume;

    private final long startTimeUs;

    private final long endTimeUs;

    private final MediaExtractor extractor;

    private MediaCodec decoder;

    private boolean hasAudioTrack = true;

    private int srcSampleRate;

    private int srcChannelCount;

    private boolean inputDone = false;

    private boolean outputDone = false;

    private boolean firstBuffer = true;

    private final MediaCodec.BufferInfo decoderBufferInfo = new MediaCodec.BufferInfo();

    // Decoded source samples (interleaved), starting at bufferStartFrame
    // (source frame index, 0 = item startTime).
    private short[] buffer = new short[0];

    private long bufferStartFrame = 0;

    private int bufferFrames = 0;

    ItemDecoder(VideoComposition.Item item) throws Exception {
      itemStartFrame = Math.round(item.getCompositionStartTime() * sampleRate);
      itemEndFrame = itemStartFrame + Math.round(item.getDuration() * sampleRate);
      volume = Math.max(0, Math.min(1, item.getAudioVolume()));
      startTimeUs = TimeHelpers.secToUs(item.getStartTime());
      endTimeUs = startTimeUs + TimeHelpers.secToUs(item.getDuration());

      extractor = new MediaExtractor();
      try {
        extractor.setDataSource(item.getPath());
        int audioTrackIndex = -1;
        MediaFormat audioFormat = null;
        for (int i = 0; i < extractor.getTrackCount(); i++) {
          MediaFormat trackFormat = extractor.getTrackFormat(i);
          String mime = trackFormat.getString(MediaFormat.KEY_MIME);
          if (mime != null && mime.startsWith("audio/")) {
            audioTrackIndex = i;
            audioFormat = trackFormat;
            break;
          }
        }
        if (audioTrackIndex == -1) {
          if (item.isVideo()) {
            // Video item without audio track: keep it silent.
            hasAudioTrack = false;
            return;
          }
          throw new RuntimeException(
            "No audio track for path: " + item.getPath());
        }
        extractor.selectTrack(audioTrackIndex);
        extractor.seekTo(startTimeUs, MediaExtractor.SEEK_TO_PREVIOUS_SYNC);

        srcSampleRate = audioFormat.getInteger(MediaFormat.KEY_SAMPLE_RATE);
        srcChannelCount = audioFormat.getInteger(MediaFormat.KEY_CHANNEL_COUNT);
        String mime = audioFormat.getString(MediaFormat.KEY_MIME);
        decoder = MediaCodec.createDecoderByType(mime);
        decoder.configure(audioFormat, null, null, 0);
        decoder.start();
      } catch (Exception e) {
        release();
        throw e;
      }
    }

    void mixInto(int[] mix, long chunkStartFrame, int frames) {
      if (!hasAudioTrack) {
        return;
      }
      long overlapStart = Math.max(chunkStartFrame, itemStartFrame);
      long overlapEnd = Math.min(chunkStartFrame + frames, itemEndFrame);
      if (overlapEnd <= overlapStart) {
        return;
      }
      for (long frame = overlapStart; frame < overlapEnd; frame++) {
        long localFrame = frame - itemStartFrame;
        double srcFrame = localFrame * srcSampleRate / (double) sampleRate;
        long srcFrameIndex = (long) srcFrame;
        if (!ensureSamplesUpTo(srcFrameIndex + 2)) {
          break;
        }
        double fraction = srcFrame - srcFrameIndex;
        int mixIndex = (int) (frame - chunkStartFrame) * channelCount;
        for (int channel = 0; channel < channelCount; channel++) {
          double sample = readSample(srcFrameIndex, channel) * (1 - fraction)
            + readSample(srcFrameIndex + 1, channel) * fraction;
          // Clipping only happens once every track has been accumulated
          // (in queuePcm), otherwise the result would depend on the order
          // of the items.
          mix[mixIndex + channel] += (int) Math.round(sample * volume);
        }
      }
      // Drop the consumed samples to keep memory bounded.
      long consumedUpTo =
        (long) ((overlapEnd - 1 - itemStartFrame) * srcSampleRate / (double) sampleRate);
      dropSamplesBefore(consumedUpTo - 2);
    }

    private double readSample(long srcFrameIndex, int outChannel) {
      long index = srcFrameIndex - bufferStartFrame;
      if (index < 0 || index >= bufferFrames) {
        return 0;
      }
      int frameOffset = (int) index * srcChannelCount;
      if (channelCount == 1 && srcChannelCount > 1) {
        // Downmix to mono: average the source channels.
        double sum = 0;
        for (int channel = 0; channel < srcChannelCount; channel++) {
          sum += buffer[frameOffset + channel];
        }
        return sum / srcChannelCount;
      }
      return buffer[frameOffset + Math.min(outChannel, srcChannelCount - 1)];
    }

    private boolean ensureSamplesUpTo(long srcFrameEnd) {
      int stalled = 0;
      while (bufferStartFrame + bufferFrames < srcFrameEnd) {
        if (outputDone) {
          // Past the end of the source: the remaining frames stay silent.
          return bufferStartFrame + bufferFrames > 0
            && srcFrameEnd - (bufferStartFrame + bufferFrames) < 2;
        }
        if (!pumpDecoder()) {
          if (++stalled > MAX_STALLED_ITERATIONS) {
            throw new RuntimeException("Audio decoder stalled");
          }
        } else {
          stalled = 0;
        }
      }
      return true;
    }

    private boolean pumpDecoder() {
      boolean progressed = false;
      if (!inputDone) {
        int inputIndex = decoder.dequeueInputBuffer(0);
        if (inputIndex >= 0) {
          ByteBuffer input = decoder.getInputBuffer(inputIndex);
          int size = input != null ? extractor.readSampleData(input, 0) : -1;
          long sampleTimeUs = extractor.getSampleTime();
          if (size < 0 || sampleTimeUs >= endTimeUs) {
            decoder.queueInputBuffer(
              inputIndex, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM);
            inputDone = true;
          } else {
            decoder.queueInputBuffer(inputIndex, 0, size, sampleTimeUs, 0);
            extractor.advance();
          }
          progressed = true;
        }
      }

      int outputIndex = decoder.dequeueOutputBuffer(decoderBufferInfo, CODEC_TIMEOUT_US);
      if (outputIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
        MediaFormat outputFormat = decoder.getOutputFormat();
        srcSampleRate = outputFormat.getInteger(MediaFormat.KEY_SAMPLE_RATE);
        srcChannelCount = outputFormat.getInteger(MediaFormat.KEY_CHANNEL_COUNT);
        return true;
      }
      if (outputIndex < 0) {
        return progressed;
      }
      if ((decoderBufferInfo.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) {
        outputDone = true;
      }
      ByteBuffer output = decoder.getOutputBuffer(outputIndex);
      if (output != null && decoderBufferInfo.size > 0) {
        output.position(decoderBufferInfo.offset);
        output.limit(decoderBufferInfo.offset + decoderBufferInfo.size);
        output.order(ByteOrder.LITTLE_ENDIAN);
        int sampleCount = decoderBufferInfo.size / 2;
        int frames = sampleCount / srcChannelCount;
        int skipFrames = 0;
        if (firstBuffer) {
          firstBuffer = false;
          long offsetUs = decoderBufferInfo.presentationTimeUs - startTimeUs;
          if (offsetUs < 0) {
            // Drop the samples decoded before the item start time (the
            // extractor sought to a preceding sync point).
            skipFrames = (int) Math.min(
              Math.round(-offsetUs * srcSampleRate / 1000000.0),
              frames
            );
          } else if (offsetUs > 0) {
            // The audio starts after the requested start time: keep the
            // offset so the audio stays aligned on the composition timeline.
            bufferStartFrame = Math.round(offsetUs * srcSampleRate / 1000000.0);
          }
        }
        int keptFrames = frames - skipFrames;
        if (keptFrames > 0) {
          appendSamples(output, skipFrames * srcChannelCount, keptFrames);
        }
      }
      decoder.releaseOutputBuffer(outputIndex, false);
      return true;
    }

    private void appendSamples(ByteBuffer output, int skipSamples, int frames) {
      int requiredFrames = bufferFrames + frames;
      int requiredLength = requiredFrames * srcChannelCount;
      if (buffer.length < requiredLength) {
        buffer = Arrays.copyOf(buffer, Math.max(requiredLength, buffer.length * 2));
      }
      output.position(output.position() + skipSamples * 2);
      output.asShortBuffer().get(
        buffer, bufferFrames * srcChannelCount, frames * srcChannelCount);
      bufferFrames = requiredFrames;
    }

    private void dropSamplesBefore(long srcFrame) {
      long dropFrames = srcFrame - bufferStartFrame;
      if (dropFrames <= 0) {
        return;
      }
      dropFrames = Math.min(dropFrames, bufferFrames);
      int remainingFrames = bufferFrames - (int) dropFrames;
      if (remainingFrames > 0) {
        System.arraycopy(
          buffer,
          (int) dropFrames * srcChannelCount,
          buffer,
          0,
          remainingFrames * srcChannelCount
        );
      }
      bufferStartFrame += dropFrames;
      bufferFrames = remainingFrames;
    }

    void release() {
      if (decoder != null) {
        try {
          decoder.stop();
        } catch (IllegalStateException ignored) {
        }
        decoder.release();
        decoder = null;
      }
      extractor.release();
    }
  }
}
