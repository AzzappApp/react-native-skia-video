package com.azzapp.rnskv;

import static com.azzapp.rnskv.Compositions.MONTAGE;
import static com.azzapp.rnskv.Compositions.composition;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;
import static org.junit.Assume.assumeTrue;

import android.media.Image;
import android.media.MediaCodec;
import android.media.MediaExtractor;
import android.media.MediaFormat;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import com.azzapp.rnskv.Compositions.Clip;
import com.azzapp.rnskv.TestVideo.Spec;

import org.junit.BeforeClass;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.io.File;
import java.nio.ByteBuffer;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

/**
 * The whole export: composition frames into VideoEncoder, then the written
 * file decoded back. Every frame is there, at its time, showing the source
 * frame of the right item.
 */
@RunWith(AndroidJUnit4.class)
public class EncodeTest {

  private static final int TOLERANCE = 5;

  private static File cache;

  private static File small;

  @BeforeClass
  public static void writeVideo() throws Exception {
    cache = InstrumentationRegistry.getInstrumentation().getTargetContext().getCacheDir();
    small = TestVideo.write(new File(cache, "encode-test.mp4"), 6);
  }

  @Test
  public void anEagerMontageEncodesEveryFrameOfTheRightItem() throws Exception {
    encodeAndCheck(composition(small, false, MONTAGE), MONTAGE, "h264", 320, 240, 30);
  }

  @Test
  public void aLazyMontageEncodesEveryFrameOfTheRightItem() throws Exception {
    encodeAndCheck(composition(small, true, MONTAGE), MONTAGE, "h264", 320, 240, 30);
  }

  @Test
  public void anHevcExportEncodesEveryFrame() throws Exception {
    assumeTrue("no HEVC encoder", VideoEncoder.isCodecSupported("hevc"));
    encodeAndCheck(composition(small, true, MONTAGE), MONTAGE, "hevc", 320, 240, 30);
  }

  @Test
  public void aLazy4KMontageExportsIn1080p() throws Exception {
    Spec uhd = new Spec("avc-4k", MediaFormat.MIMETYPE_VIDEO_AVC, 3840, 2160, 30, 0);
    assumeTrue(TestVideo.canEncode(uhd));
    File video = TestVideo.write(new File(cache, "encode-4k.mp4"), 4, uhd);
    Clip[] clips = {
      new Clip("x", 0, 0, 1.5),
      new Clip("y", 1.5, 2, 1.5),
      new Clip("z", 3, 1, 1),
    };
    VideoComposition composition = composition(video, true, clips);
    for (Clip clip : clips) {
      Compositions.set(Compositions.item(composition, clip.id), "maxLongSide", 1920);
    }
    encodeAndCheck(composition, clips, "h264", 1920, 1080, 30);
  }

  /**
   * An item asks for audio from a file without an audio track: the export
   * finishes, with or without an audio track, instead of hanging.
   */
  @Test
  public void anAudioItemWithoutAnAudioTrackDoesNotHoldTheExport() throws Exception {
    Clip[] clips = {new Clip("a", 0, 0, 2)};
    VideoComposition composition = composition(small, false, clips);
    Compositions.set(Compositions.item(composition, "a"), "audioEnabled", true);
    Compositions.set(Compositions.item(composition, "a"), "audioVolume", 1.0);
    ExecutorService executor = Executors.newSingleThreadExecutor();
    Future<File> done = executor.submit(() -> encode(composition, "h264", 320, 240, 30));
    try {
      File out = done.get(60, TimeUnit.SECONDS);
      assertEquals(60, readBack(out).size());
    } catch (java.util.concurrent.ExecutionException e) {
      // A clean failure is acceptable; a hang is not.
      assertTrue(String.valueOf(e.getCause()), e.getCause() instanceof RuntimeException);
    } finally {
      executor.shutdownNow();
    }
  }

  private void encodeAndCheck(
    VideoComposition composition, Clip[] clips, String codec, int width, int height, int fps
  ) throws Exception {
    File out = encode(composition, codec, width, height, fps);
    List<long[]> frames = readBack(out);
    int expected = (int) Math.round(composition.getDuration() * fps);
    assertEquals("frames in the file", expected, frames.size());
    for (int i = 0; i < frames.size(); i++) {
      long timeUs = frames.get(i)[0];
      long luma = frames.get(i)[1];
      double time = i / (double) fps;
      assertEquals("frame " + i + " time", Math.round(time * 1e6), timeUs, 1_000);
      Clip clip = Compositions.clipAt(clips, time);
      int sourceFrame = (int) Math.round((clip.start + time - clip.compositionStart) * 30);
      int expectedLuma = TestVideo.luma(sourceFrame);
      assertTrue("frame " + i + " (" + clip.id + ", source frame " + sourceFrame + ") has luma "
          + luma + ", expected " + expectedLuma,
        Math.abs(luma - expectedLuma) <= TOLERANCE);
    }
  }

  private File encode(VideoComposition composition, String codec, int width, int height, int fps)
    throws Exception {
    File out = File.createTempFile("export", ".mp4", cache);
    try (Export export = new Export(composition)) {
      VideoEncoder encoder = new VideoEncoder(
        out.getPath(), width, height, fps, 4_000_000, null, codec, composition, 44100, 2, 128_000);
      encoder.prepare();
      try {
        int frames = (int) Math.round(composition.getDuration() * fps);
        for (int i = 0; i < frames; i++) {
          double time = i / (double) fps;
          VideoFrame frame = export.frames(time).get(clipAt(frameClips(composition), time));
          encoder.makeGLContextCurrent();
          encoder.encodeFrame(frame.getTexture(), time);
        }
        encoder.finishWriting();
      } finally {
        encoder.release();
        export.gl.makeCurrent();
      }
    }
    return out;
  }

  /** The id of the item on screen at each time, from the composition. */
  private static Clip[] frameClips(VideoComposition composition) {
    List<Clip> clips = new ArrayList<>();
    for (VideoComposition.Item item : composition.getItems()) {
      clips.add(new Clip(item.getId(), item.getCompositionStartTime(), item.getStartTime(), item.getDuration()));
    }
    return clips.toArray(new Clip[0]);
  }

  private static String clipAt(Clip[] clips, double time) {
    Clip clip = Compositions.clipAt(clips, time);
    return clip == null ? null : clip.id;
  }

  /** Each frame of the file: its time and the luma at its centre. */
  static List<long[]> readBack(File file) throws Exception {
    MediaExtractor extractor = new MediaExtractor();
    extractor.setDataSource(file.getPath());
    int track = -1;
    MediaFormat format = null;
    for (int i = 0; i < extractor.getTrackCount(); i++) {
      MediaFormat candidate = extractor.getTrackFormat(i);
      if (candidate.getString(MediaFormat.KEY_MIME).startsWith("video/")) {
        track = i;
        format = candidate;
      }
    }
    assertTrue("no video track in " + file, track >= 0);
    extractor.selectTrack(track);
    MediaCodec decoder = MediaCodec.createDecoderByType(format.getString(MediaFormat.KEY_MIME));
    decoder.configure(format, null, null, 0);
    decoder.start();
    List<long[]> frames = new ArrayList<>();
    MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
    boolean inputDone = false;
    try {
      while (true) {
        if (!inputDone) {
          int in = decoder.dequeueInputBuffer(10_000);
          if (in >= 0) {
            ByteBuffer buffer = decoder.getInputBuffer(in);
            int size = extractor.readSampleData(buffer, 0);
            if (size < 0) {
              decoder.queueInputBuffer(in, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM);
              inputDone = true;
            } else {
              decoder.queueInputBuffer(in, 0, size, extractor.getSampleTime(), 0);
              extractor.advance();
            }
          }
        }
        int out = decoder.dequeueOutputBuffer(info, 10_000);
        if (out >= 0) {
          if (info.size > 0) {
            Image image = decoder.getOutputImage(out);
            Image.Plane y = image.getPlanes()[0];
            int index = (image.getHeight() / 2) * y.getRowStride() + (image.getWidth() / 2) * y.getPixelStride();
            frames.add(new long[]{info.presentationTimeUs, y.getBuffer().get(index) & 0xff});
            image.close();
          }
          decoder.releaseOutputBuffer(out, false);
          if ((info.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) {
            break;
          }
        }
      }
    } finally {
      decoder.stop();
      decoder.release();
      extractor.release();
    }
    frames.sort((a, b) -> Long.compare(a[0], b[0]));
    return frames;
  }
}
