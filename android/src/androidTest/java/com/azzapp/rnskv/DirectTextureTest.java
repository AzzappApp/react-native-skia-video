package com.azzapp.rnskv;

import static com.azzapp.rnskv.Compositions.composition;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;
import static org.junit.Assume.assumeTrue;

import android.media.MediaFormat;

import androidx.test.platform.app.InstrumentationRegistry;

import com.azzapp.rnskv.Compositions.Clip;
import com.azzapp.rnskv.TestVideo.Spec;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.junit.runners.Parameterized;

import java.io.File;
import java.util.Arrays;
import java.util.List;

/**
 * textureMode 'direct': the decoder's buffer handed over as an external
 * texture, with the picture's crop and rotation instead of a copy.
 */
@RunWith(Parameterized.class)
public class DirectTextureTest {

  private static final String AVC = MediaFormat.MIMETYPE_VIDEO_AVC;

  private static final String HEVC = MediaFormat.MIMETYPE_VIDEO_HEVC;

  @Parameterized.Parameters(name = "{0}")
  public static List<Spec> specs() {
    return Arrays.asList(
      new Spec("avc-1080p", AVC, 1920, 1080, 30, 0),
      new Spec("avc-720p", AVC, 1280, 720, 30, 0),
      new Spec("avc-638x358", AVC, 638, 358, 30, 0),
      new Spec("hevc-4k", HEVC, 3840, 2160, 30, 0),
      new Spec("avc-1080p-rot90", AVC, 1920, 1080, 30, 90));
  }

  private final Spec spec;

  public DirectTextureTest(Spec spec) {
    this.spec = spec;
  }

  private static VideoComposition direct(File video, Clip clip, boolean direct) {
    VideoComposition composition = composition(video, false, clip);
    Compositions.set(Compositions.item(composition, clip.id), "directTexture", direct);
    return composition;
  }

  @Test
  public void theFrameIsTheDecoderBufferWithItsCropAndRotation() throws Exception {
    assumeTrue(TestVideo.canEncode(spec));
    File cache = InstrumentationRegistry.getInstrumentation().getTargetContext().getCacheDir();
    File video = TestVideo.write(new File(cache, "direct-" + spec.name + ".mp4"), 2, spec);
    Clip clip = new Clip("a", 0, 0, 2);
    int[] copyCenters = new int[3];
    // Dark frames, against which the white marker stands out.
    double[] times = {0.2, 0.5, 1.2};
    try (Export export = new Export(direct(video, clip, false))) {
      for (int i = 0; i < times.length; i++) {
        VideoFrame frame = export.frames(times[i]).get("a");
        copyCenters[i] = Pixels.center(frame.getTexture(), frame.getWidth(), frame.getHeight())[0];
      }
    }
    try (Export export = new Export(direct(video, clip, true))) {
      for (int i = 0; i < times.length; i++) {
        double time = times[i];
        VideoFrame frame = export.frames(time).get("a");
        Compositions.assertFrameAt(java.util.Map.of("a", frame), clip, time, 1_000);
        String at = spec + " at " + time + "s";
        assertEquals(at, VideoFrame.TARGET_EXTERNAL, frame.getTarget());
        assertEquals(at + " rotation", spec.rotation, frame.getRotation());
        // The picture, in the buffer's orientation, from its top-left corner.
        assertEquals(at, 0, frame.getCropX());
        assertEquals(at, 0, frame.getCropY());
        assertEquals(at, spec.width, frame.getCropWidth());
        assertEquals(at, spec.height, frame.getCropHeight());
        // The buffer holds the picture, padded to the codec's alignment at most.
        assertTrue(at + " buffer " + frame.getWidth() + "x" + frame.getHeight(),
          frame.getWidth() >= spec.width && frame.getWidth() < spec.width + 64
            && frame.getHeight() >= spec.height && frame.getHeight() < spec.height + 64);
        float width = frame.getWidth();
        float height = frame.getHeight();
        int center = Pixels.externalAt(frame.getTexture(),
          spec.width / 2f / width, spec.height / 2f / height);
        int expected = TestVideo.gray((int) Math.round(frame.getTimestampNs() / 1e9 * spec.fps));
        assertTrue(at + ": centre " + center + ", expected " + expected,
          Math.abs(center - expected) <= Pixels.TOLERANCE);
        assertTrue(at + ": centre " + center + ", the copy's " + copyCenters[i],
          Math.abs(center - copyCenters[i]) <= Pixels.TOLERANCE);
        // The marker, top-left of the picture as encoded: the first rows of the
        // buffer are its top, which is what Skia shows at the top.
        int marker = Pixels.externalAt(frame.getTexture(),
          spec.width / 8f / width, spec.height / 8f / height);
        assertTrue(at + ": marker " + marker + " against " + center, marker > center + 50);
        int opposite = Pixels.externalAt(frame.getTexture(),
          spec.width * 7 / 8f / width, spec.height * 7 / 8f / height);
        assertTrue(at + ": bottom-right " + opposite, Math.abs(opposite - center) <= Pixels.TOLERANCE);
      }
    }
  }
}
