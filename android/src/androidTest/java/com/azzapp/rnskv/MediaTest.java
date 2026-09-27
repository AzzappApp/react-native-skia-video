package com.azzapp.rnskv;

import static com.azzapp.rnskv.Compositions.assertFrameAt;
import static com.azzapp.rnskv.Compositions.composition;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;
import static org.junit.Assume.assumeTrue;

import android.media.MediaFormat;
import android.os.SystemClock;

import androidx.test.platform.app.InstrumentationRegistry;

import com.azzapp.rnskv.Compositions.Clip;
import com.azzapp.rnskv.TestVideo.Spec;

import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.junit.runners.Parameterized;

import java.io.File;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Sources other than the small H.264 file: large, HEVC, 60 fps, rotated, a
 * size no codec aligns to. Export and preview, timestamps and pixels.
 */
@RunWith(Parameterized.class)
public class MediaTest {

  private static final String AVC = MediaFormat.MIMETYPE_VIDEO_AVC;

  private static final String HEVC = MediaFormat.MIMETYPE_VIDEO_HEVC;

  @Parameterized.Parameters(name = "{0}")
  public static List<Spec> specs() {
    return Arrays.asList(
      new Spec("avc-1080p", AVC, 1920, 1080, 30, 0),
      new Spec("avc-4k", AVC, 3840, 2160, 30, 0),
      new Spec("hevc-1080p", HEVC, 1920, 1080, 30, 0),
      new Spec("hevc-4k", HEVC, 3840, 2160, 30, 0),
      new Spec("avc-720p60", AVC, 1280, 720, 60, 0),
      new Spec("avc-720p-rot90", AVC, 1280, 720, 30, 90),
      new Spec("avc-720p-rot180", AVC, 1280, 720, 30, 180),
      new Spec("hevc-1080p-rot270", HEVC, 1920, 1080, 30, 270),
      new Spec("avc-638x358", AVC, 638, 358, 30, 0));
  }

  private static final Map<String, File> files = new HashMap<>();

  private final Spec spec;

  private File video;

  private AutoCloseable open;

  public MediaTest(Spec spec) {
    this.spec = spec;
  }

  @Before
  public void writeVideo() throws Exception {
    assumeTrue(spec + ": no encoder on this device", TestVideo.canEncode(spec));
    video = files.get(spec.name);
    if (video == null) {
      File cache = InstrumentationRegistry.getInstrumentation().getTargetContext().getCacheDir();
      video = TestVideo.write(new File(cache, "media-" + spec.name + ".mp4"), 3, spec);
      files.put(spec.name, video);
    }
  }

  @After
  public void close() throws Exception {
    if (open != null) {
      open.close();
    }
  }

  @Test
  public void theExportGivesEveryFrameWithItsPixels() throws Exception {
    Clip clip = new Clip("a", 0, 0.5, 2);
    Export export = new Export(composition(video, false, clip));
    open = export;
    int frames = (int) Math.round(clip.duration * spec.fps);
    for (int i = 0; i < frames; i++) {
      double time = i / (double) spec.fps;
      VideoFrame frame = export.frames(time).get("a");
      assertFrameAt(Map.of("a", frame), clip, time, 1_000);
      Pixels.assertShowsItsFrame(spec + " at " + time + "s", frame, spec.fps);
      // Composition frames come upright: the texture is drawn rotated.
      assertEquals("rotation", 0, frame.getRotation());
      boolean quarter = spec.rotation % 180 != 0;
      assertEquals("width", quarter ? spec.height : spec.width, frame.getWidth());
      assertEquals("height", quarter ? spec.width : spec.height, frame.getHeight());
    }
  }

  /**
   * Displayed clockwise by the rotation: from the unrotated top-left, the
   * marker goes top-right at 90, bottom-left at 270. "Top" is whichever row
   * the unrotated frame has it in, so GL's flip does not matter.
   */
  @Test
  public void theFrameIsDrawnUpright() throws Exception {
    Clip clip = new Clip("a", 0, 0, 1);
    boolean[] reference;
    File plain = TestVideo.write(
      new File(video.getParentFile(), "media-" + spec.name + "-plain.mp4"), 1,
      new Spec(spec.name + "-plain", spec.mime, spec.width, spec.height, spec.fps, 0));
    try (Export export = new Export(composition(plain, false, clip))) {
      reference = Pixels.marker(export.frames(0.2).get("a"));
    }
    Export export = new Export(composition(video, false, clip));
    open = export;
    boolean[] marker = Pixels.marker(export.frames(0.2).get("a"));
    boolean left = reference[0];
    boolean top = reference[1];
    if (spec.rotation == 90) {
      left = !left;
    } else if (spec.rotation == 180) {
      left = !left;
      top = !top;
    } else if (spec.rotation == 270) {
      top = !top;
    }
    assertEquals(spec + " marker left", left, marker[0]);
    assertEquals(spec + " marker top", top, marker[1]);
  }

  @Test
  public void maxLongSideCapsTheFrame() throws Exception {
    Clip clip = new Clip("a", 0, 0, 2);
    VideoComposition composition = composition(video, false, clip);
    Compositions.set(Compositions.item(composition, "a"), "maxLongSide", 640);
    Export export = new Export(composition);
    open = export;
    VideoFrame frame = export.frames(1.0).get("a");
    int longSide = Math.max(frame.getWidth(), frame.getHeight());
    int shortSide = Math.min(frame.getWidth(), frame.getHeight());
    int sourceLong = Math.max(spec.width, spec.height);
    int sourceShort = Math.min(spec.width, spec.height);
    assertEquals(Math.min(640, sourceLong), longSide);
    assertEquals(sourceShort * longSide / (double) sourceLong, shortSide, 1.5);
    Pixels.assertShowsItsFrame(spec + " capped", frame, spec.fps);
  }

  @Test
  public void thePreviewSeeksToExactFramesAndPlays() {
    Clip clip = new Clip("a", 0, 0, 3);
    Player player = new Player(composition(video, false, clip));
    open = player;
    for (double time : new double[]{2.0, 0.3, 2.9, 1.1}) {
      player.seek(time);
      long expectedUs = clip.sourceUs(time);
      Map<String, VideoFrame> frames = player.drawUntil("exact frame at " + time, 4000, f -> {
        VideoFrame frame = f.get("a");
        if (frame == null) {
          return false;
        }
        long actualUs = TimeHelpers.nsecToUs(frame.getTimestampNs());
        return actualUs <= expectedUs + 1_000 && actualUs >= expectedUs - spec.frameUs() - 1_000;
      });
      Pixels.assertShowsItsFrame(spec + " seek " + time, frames.get("a"), spec.fps);
    }
    player.extractor.play();
    SystemClock.sleep(600);
    VideoFrame frame = player.frames().get("a");
    assertTrue("did not play on", TimeHelpers.nsecToUs(frame.getTimestampNs()) > 1_400_000);
    Pixels.assertShowsItsFrame(spec + " playing", frame, spec.fps);
    assertTrue("errors: " + player.errors, player.errors.isEmpty());
  }
}
