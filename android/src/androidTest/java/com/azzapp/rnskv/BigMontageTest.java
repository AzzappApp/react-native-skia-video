package com.azzapp.rnskv;

import static com.azzapp.rnskv.Compositions.clipAt;
import static com.azzapp.rnskv.Compositions.composition;
import static com.azzapp.rnskv.Compositions.openCount;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;
import static org.junit.Assume.assumeTrue;

import android.media.MediaFormat;
import android.os.SystemClock;
import android.util.Log;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import com.azzapp.rnskv.Compositions.Clip;
import com.azzapp.rnskv.TestVideo.Spec;

import org.junit.BeforeClass;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.io.File;
import java.util.Map;

/**
 * Frameburn's case: a montage of many 4K clips. Eager, every clip holds a 4K
 * hardware decoder for the whole composition; lazy, two or three at a time.
 */
@RunWith(AndroidJUnit4.class)
public class BigMontageTest {

  private static final String TAG = "BigMontageTest";

  private static final Spec UHD =
    new Spec("avc-4k", MediaFormat.MIMETYPE_VIDEO_AVC, 3840, 2160, 30, 0);

  /** Eight 1 s clips from all over a 4 s 4K file. */
  private static final Clip[] CLIPS = new Clip[8];

  static {
    double[] starts = {0, 2.5, 1, 3, 0.5, 2, 1.5, 0.2};
    for (int i = 0; i < CLIPS.length; i++) {
      CLIPS[i] = new Clip("clip" + i, i, starts[i], 1);
    }
  }

  private static File video;

  @BeforeClass
  public static void writeVideo() throws Exception {
    assumeTrue("no 4K H.264 encoder", TestVideo.canEncode(UHD));
    File cache = InstrumentationRegistry.getInstrumentation().getTargetContext().getCacheDir();
    video = TestVideo.write(new File(cache, "montage-4k.mp4"), 4, UHD);
  }

  @Test
  public void aLazyExportOfEight4KClipsGivesEveryFrame() throws Exception {
    try (Export export = new Export(composition(video, true, CLIPS))) {
      int maxOpen = 0;
      for (int i = 0; i < 8 * 30; i += 2) {
        double time = i / 30.0;
        Map<String, VideoFrame> frames = export.frames(time);
        Clip clip = clipAt(CLIPS, time);
        Compositions.assertFrameAt(frames, clip, time, 1_000);
        Pixels.assertShowsItsFrame(clip.id + " at " + time, frames.get(clip.id), 30);
        maxOpen = Math.max(maxOpen, openCount(export.decoder(), export.composition));
      }
      assertTrue("up to " + maxOpen + " decoders open", maxOpen <= 2);
    }
  }

  @Test
  public void aLazyPreviewOfEight4KClipsPlaysThrough() {
    try (Player player = new Player(composition(video, true, CLIPS))) {
      VideoCompositionDecoder decoder =
        (VideoCompositionDecoder) Compositions.get(player.extractor, "decoder");
      player.extractor.play();
      int maxOpen = 0;
      int shown = 0;
      int missing = 0;
      long deadline = SystemClock.uptimeMillis() + 20_000;
      while (!player.events.contains("complete")) {
        assertTrue("no complete, position " + player.position(), SystemClock.uptimeMillis() < deadline);
        double time = player.position();
        Map<String, VideoFrame> frames = player.frames();
        Clip clip = clipAt(CLIPS, time);
        if (clip != null && time - clip.compositionStart > 0.3 && clip.end() - time > 0.2) {
          VideoFrame frame = frames.get(clip.id);
          if (frame == null) {
            missing++;
          } else {
            long lag = clip.sourceUs(time) - TimeHelpers.nsecToUs(frame.getTimestampNs());
            assertTrue(clip.id + " lags " + lag + "us at " + time, Math.abs(lag) < 300_000);
            shown++;
          }
        }
        maxOpen = Math.max(maxOpen, openCount(decoder, player.composition));
        SystemClock.sleep(16);
      }
      Log.i(TAG, "lazy 4K preview: " + shown + " frames on time, " + missing + " missing, max open " + maxOpen);
      assertEquals("frames missing 0.3 s into their clip", 0, missing);
      assertTrue(shown > 150);
      assertTrue("up to " + maxOpen + " decoders open", maxOpen <= 3);
      assertTrue("errors: " + player.errors, player.errors.isEmpty());
    }
  }

  @Test
  public void aLazyScrubOverEight4KClipsSettles() {
    try (Player player = new Player(composition(video, true, CLIPS))) {
      for (int i = 0; i < 120; i++) {
        player.seek((i * 37 % 80) / 10.0);
        player.frames();
        SystemClock.sleep(16);
      }
      for (double time : new double[]{6.5, 1.2, 7.9}) {
        player.seek(time);
        Clip clip = clipAt(CLIPS, time);
        long expected = clip.sourceUs(time);
        Map<String, VideoFrame> frames = player.drawUntil(clip.id + " at " + time, 5000, f -> {
          VideoFrame frame = f.get(clip.id);
          return frame != null && Math.abs(TimeHelpers.nsecToUs(frame.getTimestampNs()) - expected) < 34_000;
        });
        Pixels.assertShowsItsFrame(clip.id + " at " + time, frames.get(clip.id), 30);
      }
      assertTrue("errors: " + player.errors, player.errors.isEmpty());
    }
  }

  /**
   * Eager: eight 4K decoders at once, more than most phones have. It must
   * either work or fail with an exception, never hang or crash; the log says
   * which.
   */
  @Test
  public void anEagerExportOfEight4KClipsWorksOrFailsCleanly() {
    String outcome;
    try (Export export = new Export(composition(video, false, CLIPS))) {
      for (int i = 0; i < 8; i++) {
        double time = i + 0.5;
        Clip clip = clipAt(CLIPS, time);
        Compositions.assertFrameAt(export.frames(time), clip, time, 1_000);
      }
      outcome = "works";
    } catch (Exception e) {
      outcome = "fails: " + e;
    }
    Log.i(TAG, "eager export of eight 4K clips " + outcome);
  }

  @Test
  public void anEagerPreviewOfEight4KClipsWorksOrReportsAnError() {
    String outcome;
    try (Player player = new Player(composition(video, false, CLIPS))) {
      player.seek(6.5);
      Clip clip = clipAt(CLIPS, 6.5);
      try {
        player.drawUntil("eager frame", 5000, f -> f.get(clip.id) != null || !player.errors.isEmpty());
        outcome = player.errors.isEmpty() ? "works" : "reports " + player.errors;
      } catch (AssertionError e) {
        outcome = "shows nothing: " + e.getMessage();
      }
    } catch (Exception e) {
      outcome = "fails: " + e;
    }
    Log.i(TAG, "eager preview of eight 4K clips " + outcome);
  }
}
