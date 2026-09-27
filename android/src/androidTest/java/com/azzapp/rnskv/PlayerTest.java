package com.azzapp.rnskv;

import static com.azzapp.rnskv.Compositions.MONTAGE;
import static com.azzapp.rnskv.Compositions.clipAt;
import static com.azzapp.rnskv.Compositions.composition;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import android.os.SystemClock;

import androidx.test.platform.app.InstrumentationRegistry;

import com.azzapp.rnskv.Compositions.Clip;

import org.junit.After;
import org.junit.BeforeClass;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.junit.runners.Parameterized;

import java.io.File;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Random;

/**
 * The preview as the app drives it: the real player, its playback loop, and a
 * draw every vsync on the test thread. Seeks paused and playing, backwards,
 * onto cuts, past the end; loops; scrubs; pause and replay. Eager and lazy.
 */
@RunWith(Parameterized.class)
public class PlayerTest {

  private static final long PAUSED_SLACK_US = 1_000;

  private static final long PLAYING_SLACK_US = 250_000;

  @Parameterized.Parameters(name = "lazy={0}")
  public static List<Object[]> modes() {
    return Arrays.asList(new Object[][]{{false}, {true}});
  }

  private final boolean lazy;

  private static File video;

  private Player player;

  public PlayerTest(boolean lazy) {
    this.lazy = lazy;
  }

  @BeforeClass
  public static void writeVideo() throws Exception {
    File cache = InstrumentationRegistry.getInstrumentation().getTargetContext().getCacheDir();
    video = TestVideo.write(new File(cache, "player-test.mp4"), 6);
  }

  @After
  public void close() {
    if (player != null) {
      List<String> errors = player.errors;
      player.close();
      assertTrue("player errors: " + errors, errors.isEmpty());
      assertFalse("a decoder thread outlived release()", Player.threadAlive());
    }
  }

  private Player open() {
    player = new Player(composition(video, lazy, MONTAGE));
    return player;
  }

  @Test
  public void playsThroughAndCompletes() {
    open();
    player.extractor.play();
    int checked = 0;
    long deadline = SystemClock.uptimeMillis() + 10_000;
    while (!player.events.contains("complete")) {
      assertTrue("no complete event, position " + player.position(), SystemClock.uptimeMillis() < deadline);
      double before = player.position();
      Map<String, VideoFrame> frames = player.frames();
      Clip clip = clipAt(MONTAGE, before);
      if (clip != null && before - clip.compositionStart > 0.3 && clip.end() - before > 0.3) {
        assertNear(frames, clip, before, PLAYING_SLACK_US);
        checked++;
      }
      SystemClock.sleep(16);
    }
    assertTrue("only " + checked + " frames checked", checked > 100);
    assertEquals(6.0, player.position(), 0.001);
    assertFalse(player.extractor.getIsPlaying());
  }

  @Test
  public void aPausedSeekShowsTheExactFrameInAnyOrder() {
    open();
    // Backwards, forwards, onto both sides of the cuts, the first and the
    // last frame.
    double[] times = {5.5, 0.5, 3.2, 1.9, 4.0, 2.0, 0.0, 5.95, 1.0, 3.999};
    for (double time : times) {
      seekAndCheck(time);
    }
  }

  @Test
  public void aSeekWhilePlayingPlaysOnFromThere() {
    open();
    player.extractor.play();
    SystemClock.sleep(500);
    player.seek(4.2);
    Clip c = MONTAGE[2];
    player.drawUntil("c near 4.2s", 3000, frames -> {
      VideoFrame frame = frames.get("c");
      // The position first: eager, c's frame near 2.2 s is there before the seek.
      return player.position() >= 4.2 && frame != null
        && Math.abs(TimeHelpers.nsecToUs(frame.getTimestampNs()) - c.sourceUs(player.position())) < 250_000;
    });
    double after = player.position();
    assertTrue("position " + after + " after a seek to 4.2 s", after >= 4.2 && after < 5.2);
    SystemClock.sleep(400);
    player.frames();
    assertTrue("the clock stopped after the seek", player.position() > after + 0.2);
  }

  @Test
  public void aSeekPastTheEndDoesNotBreakThePlayer() {
    open();
    player.seek(60);
    for (int i = 0; i < 30; i++) {
      player.frames();
      SystemClock.sleep(16);
    }
    player.seek(-1);
    for (int i = 0; i < 30; i++) {
      player.frames();
      SystemClock.sleep(16);
    }
    seekAndCheck(1.5);
  }

  @Test
  public void aLoopWrapsToTheFirstItem() {
    open();
    player.extractor.setIsLooping(true);
    player.seek(5.2);
    seekAndCheck(5.2);
    player.extractor.play();
    // Past the wrap, clip a plays again from its start.
    Clip a = MONTAGE[0];
    player.drawUntil("clip a again after the loop", 4000, frames -> {
      double position = player.position();
      VideoFrame frame = frames.get("a");
      return position > 0.4 && position < 1.5 && frame != null
        && Math.abs(TimeHelpers.nsecToUs(frame.getTimestampNs()) - a.sourceUs(position)) < PLAYING_SLACK_US;
    });
    assertTrue(player.extractor.getIsPlaying());
    assertTrue("complete is sent on the wrap", player.events.contains("complete"));
  }

  @Test
  public void aScrubSettlesOnTheLastSeek() {
    open();
    Random random = new Random(42);
    for (int i = 0; i < 90; i++) {
      player.seek(random.nextDouble() * 6);
      player.frames();
      SystemClock.sleep(random.nextInt(20));
    }
    seekAndCheck(3.3);
    seekAndCheck(0.7);
  }

  @Test
  public void aScrubWhilePlayingSettles() {
    open();
    player.extractor.play();
    Random random = new Random(7);
    for (int i = 0; i < 60; i++) {
      player.seek(random.nextDouble() * 6);
      player.frames();
      SystemClock.sleep(16);
    }
    player.extractor.pause();
    seekAndCheck(2.5);
  }

  // Regression: MediaCodec callbacks queued before a seek's flush ran after
  // it and handed out buffers of the new position as stale ones: the frame
  // froze on one from before the seek, in 26 rounds out of 30.
  @Test
  public void aPausedSeekAfterAScrubShowsItsFrameEveryTime() {
    for (int round = 0; round < 12; round++) {
      open();
      player.extractor.play();
      Random random = new Random(round);
      for (int i = 0; i < 60; i++) {
        player.seek(random.nextDouble() * 6);
        player.frames();
        SystemClock.sleep(16);
      }
      player.extractor.pause();
      seekAndCheck(2.5);
      close();
      player = null;
    }
  }

  @Test
  public void pauseStopsTheClockAndPlayResumes() {
    open();
    player.extractor.play();
    SystemClock.sleep(600);
    player.extractor.pause();
    SystemClock.sleep(50);
    double paused = player.position();
    SystemClock.sleep(400);
    assertEquals(paused, player.position(), 0.001);
    player.extractor.play();
    SystemClock.sleep(400);
    assertTrue(player.position() > paused + 0.25);
  }

  @Test
  public void playAfterTheEndStartsOver() {
    open();
    player.seek(5.7);
    player.extractor.play();
    player.awaitEvent("complete", 3000);
    player.extractor.play();
    Clip a = MONTAGE[0];
    player.drawUntil("clip a after replay", 3000, frames -> {
      double position = player.position();
      return position < 1.5 && frames.get("a") != null;
    });
  }

  private void seekAndCheck(double time) {
    player.seek(time);
    Clip clip = clipAt(MONTAGE, time);
    long expectedUs = clip.sourceUs(time);
    Map<String, VideoFrame> frames = player.drawUntil(clip.id + " exact at " + time + "s", 3000, f -> {
      VideoFrame frame = f.get(clip.id);
      if (frame == null) {
        return false;
      }
      long actualUs = TimeHelpers.nsecToUs(frame.getTimestampNs());
      return actualUs <= expectedUs + PAUSED_SLACK_US
        && actualUs >= expectedUs - TestVideo.FRAME_US - PAUSED_SLACK_US;
    });
    Pixels.assertShowsItsFrame(clip.id + " at " + time + "s", frames.get(clip.id), TestVideo.FPS);
  }

  private static void assertNear(Map<String, VideoFrame> frames, Clip clip, double time, long slackUs) {
    VideoFrame frame = frames.get(clip.id);
    assertTrue(clip.id + " has no frame at " + time + "s: " + Player.describe(frames), frame != null);
    long actualUs = TimeHelpers.nsecToUs(frame.getTimestampNs());
    long expectedUs = clip.sourceUs(time);
    assertTrue(clip.id + " at " + time + "s shows " + actualUs + "us, expected about " + expectedUs,
      Math.abs(actualUs - expectedUs) <= slackUs);
    Pixels.assertShowsItsFrame(clip.id + " at " + time + "s", frame, TestVideo.FPS);
  }
}
