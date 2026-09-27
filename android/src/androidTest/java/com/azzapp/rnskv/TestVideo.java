package com.azzapp.rnskv;

import android.media.Image;
import android.media.MediaCodec;
import android.media.MediaCodecInfo;
import android.media.MediaCodecList;
import android.media.MediaFormat;
import android.media.MediaMuxer;

import java.io.File;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.util.Arrays;

/**
 * Files encoded on the device, so the tests carry no media. Frame i is at
 * i / fps s, a key frame every second, and is a flat grey whose level says
 * which frame it is ({@link #luma}), so a test can check the pixels of a
 * frame and not only its timestamp. A white block marks the top-left
 * quarter of the stored picture, so a test can check the orientation.
 */
final class TestVideo {

  static final int WIDTH = 320;

  static final int HEIGHT = 240;

  static final int FPS = 30;

  static final long FRAME_US = 1_000_000L / FPS;

  /** What to encode. */
  static final class Spec {
    final String name;
    final String mime;
    final int width;
    final int height;
    final int fps;
    final int rotation;

    Spec(String name, String mime, int width, int height, int fps, int rotation) {
      this.name = name;
      this.mime = mime;
      this.width = width;
      this.height = height;
      this.fps = fps;
      this.rotation = rotation;
    }

    long frameUs() {
      return 1_000_000L / fps;
    }

    @Override
    public String toString() {
      return name;
    }
  }

  static final Spec SMALL =
    new Spec("avc-320x240", MediaFormat.MIMETYPE_VIDEO_AVC, WIDTH, HEIGHT, FPS, 0);

  private TestVideo() {
  }

  static final int MARKER_LUMA = 235;

  /** The luma of frame i. */
  static int luma(int frame) {
    return 16 + (frame * 7) % 220;
  }

  /** The grey frame i reads back as in RGB, video range expanded. */
  static int gray(int frame) {
    return Math.round((luma(frame) - 16) * 255f / 219f);
  }

  /** Whether the device has an encoder for the spec, to skip rather than fail. */
  static boolean canEncode(Spec spec) {
    MediaFormat format = MediaFormat.createVideoFormat(spec.mime, spec.width, spec.height);
    format.setInteger(MediaFormat.KEY_FRAME_RATE, spec.fps);
    return new MediaCodecList(MediaCodecList.REGULAR_CODECS).findEncoderForFormat(format) != null;
  }

  static File write(File file, double seconds) throws IOException {
    return write(file, seconds, SMALL);
  }

  static File write(File file, double seconds, Spec spec) throws IOException {
    int width = spec.width;
    int height = spec.height;
    int fps = spec.fps;
    int frames = (int) Math.round(seconds * fps);
    MediaFormat format = MediaFormat.createVideoFormat(spec.mime, width, height);
    format.setInteger(
      MediaFormat.KEY_COLOR_FORMAT,
      MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420Flexible);
    // Flat frames: a low rate keeps the grey exact.
    format.setInteger(MediaFormat.KEY_BIT_RATE, Math.max(400_000, width * height * fps / 20));
    format.setInteger(MediaFormat.KEY_FRAME_RATE, fps);
    format.setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1);

    MediaCodec encoder = MediaCodec.createEncoderByType(spec.mime);
    MediaMuxer muxer = new MediaMuxer(file.getPath(), MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4);
    muxer.setOrientationHint(spec.rotation);
    boolean muxing = false;
    try {
      encoder.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE);
      encoder.start();
      MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
      int track = -1;
      int queued = 0;
      boolean inputDone = false;
      boolean outputDone = false;
      while (!outputDone) {
        if (!inputDone) {
          int in = encoder.dequeueInputBuffer(10_000);
          if (in >= 0) {
            long ptsUs = queued * 1_000_000L / fps;
            if (queued == frames) {
              encoder.queueInputBuffer(in, 0, 0, ptsUs, MediaCodec.BUFFER_FLAG_END_OF_STREAM);
              inputDone = true;
            } else {
              Image image = encoder.getInputImage(in);
              if (image == null) {
                throw new IOException("The encoder takes no flexible YUV input");
              }
              fill(image, width, height, luma(queued));
              encoder.queueInputBuffer(in, 0, width * height * 3 / 2, ptsUs, 0);
              queued++;
            }
          }
        }
        int out = encoder.dequeueOutputBuffer(info, 10_000);
        if (out == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
          track = muxer.addTrack(encoder.getOutputFormat());
          muxer.start();
          muxing = true;
        } else if (out >= 0) {
          ByteBuffer data = encoder.getOutputBuffer(out);
          boolean config = (info.flags & MediaCodec.BUFFER_FLAG_CODEC_CONFIG) != 0;
          if (!config && info.size > 0 && muxing && data != null) {
            data.position(info.offset);
            data.limit(info.offset + info.size);
            muxer.writeSampleData(track, data, info);
          }
          encoder.releaseOutputBuffer(out, false);
          outputDone = (info.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0;
        }
      }
      encoder.stop();
    } finally {
      encoder.release();
      if (muxing) {
        muxer.stop();
      }
      muxer.release();
    }
    return file;
  }

  private static void fill(Image image, int width, int height, int luma) {
    Image.Plane[] planes = image.getPlanes();
    fillPlane(planes[0], width, height, (byte) luma);
    fillPlane(planes[0], width / 4, height / 4, (byte) MARKER_LUMA);
    fillPlane(planes[1], (width + 1) / 2, (height + 1) / 2, (byte) 128);
    fillPlane(planes[2], (width + 1) / 2, (height + 1) / 2, (byte) 128);
  }

  // Row by row in bulk: a 4K frame pixel by pixel takes seconds. With
  // interleaved chroma the row covers the other plane's bytes too, which get
  // the same 128.
  private static void fillPlane(Image.Plane plane, int width, int height, byte value) {
    ByteBuffer buffer = plane.getBuffer();
    int rowStride = plane.getRowStride();
    int pixelStride = plane.getPixelStride();
    int rowBytes = (width - 1) * pixelStride + 1;
    byte[] row = new byte[rowBytes];
    Arrays.fill(row, value);
    for (int y = 0; y < height; y++) {
      int index = y * rowStride;
      int length = Math.min(rowBytes, buffer.limit() - index);
      if (length <= 0) {
        break;
      }
      buffer.position(index);
      buffer.put(row, 0, length);
    }
    buffer.rewind();
  }
}
