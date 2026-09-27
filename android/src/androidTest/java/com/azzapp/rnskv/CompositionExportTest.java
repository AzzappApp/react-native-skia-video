package com.azzapp.rnskv;

import static com.azzapp.rnskv.Compositions.MONTAGE;
import static com.azzapp.rnskv.Compositions.assertFrameAt;
import static com.azzapp.rnskv.Compositions.clipAt;
import static com.azzapp.rnskv.Compositions.composition;
import static com.azzapp.rnskv.Compositions.openCount;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import com.azzapp.rnskv.Compositions.Clip;

import org.junit.After;
import org.junit.Before;
import org.junit.BeforeClass;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.io.File;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

import javax.microedition.khronos.egl.EGL10;

/**
 * The export's path, VideoCompositionFramesExtractorSync, on the device's own
 * decoder: the frame each item hands over at every exported time.
 */
@RunWith(AndroidJUnit4.class)
public class CompositionExportTest {

  // An exact frame: the export waits for it.
  private static final long SLACK_US = 1_000;

  private static File video;

  private EGLResourcesHolder gl;

  private final List<VideoCompositionFramesExtractorSync> extractors = new ArrayList<>();

  private final ExecutorService executor = Executors.newSingleThreadExecutor();

  @BeforeClass
  public static void writeVideo() throws Exception {
    File cache = InstrumentationRegistry.getInstrumentation().getTargetContext().getCacheDir();
    video = TestVideo.write(new File(cache, "export-test.mp4"), 6);
  }

  @Before
  public void makeContext() {
    // start() shares the context current on the calling thread, as the
    // export worklet's is in the app.
    gl = EGLResourcesHolder.createWithPBBufferSurface(EGL10.EGL_NO_CONTEXT);
    gl.makeCurrent();
  }

  @After
  public void releaseAll() {
    for (VideoCompositionFramesExtractorSync extractor : extractors) {
      extractor.release();
    }
    executor.shutdownNow();
    if (gl != null) {
      gl.release();
    }
  }

  @Test
  public void aSingleItemGivesItsFrameAtEveryTime() throws Exception {
    Clip[] clips = {new Clip("a", 0, 0, 6)};
    walk(composition(video, false, clips), clips, false);
  }

  @Test
  public void aMontageGivesEachItemItsFrame() throws Exception {
    walk(composition(video, false, MONTAGE), MONTAGE, false);
  }

  @Test
  public void aLazyMontageGivesTheSameFramesWithFewerDecoders() throws Exception {
    walk(composition(video, true, MONTAGE), MONTAGE, true);
  }

  // Regression: an item that ends without a frame in its range held the
  // export forever.
  @Test
  public void anItemWithoutFramesDoesNotHoldTheExport() throws Exception {
    Clip present = new Clip("present", 0, 0, 2);
    Clip gone = new Clip("gone", 0, 20, 2);
    VideoCompositionFramesExtractorSync extractor = start(composition(video, false, present, gone));
    Map<String, VideoFrame> frames = decode(extractor, 0.5);
    assertFrameAt(frames, present, 0.5, SLACK_US);
    assertFalse(frames.containsKey("gone"));
  }

  @Test
  public void maxLongSideSizesTheFrame() throws Exception {
    Clip clip = new Clip("a", 0, 0, 2);
    VideoComposition composition = composition(video, false, clip);
    Compositions.set(Compositions.item(composition, "a"), "maxLongSide", 160);
    VideoFrame frame = decode(start(composition), 0.5).get("a");
    assertNotNull(frame);
    assertEquals(160, frame.getWidth());
    assertEquals(120, frame.getHeight());
  }

  // A decoder left open by release() would run the device out of codecs
  // well before the last round.
  @Test
  public void releaseLeavesNoDecoderBehind() throws Exception {
    for (int round = 0; round < 30; round++) {
      boolean lazy = round % 2 == 1;
      VideoCompositionFramesExtractorSync extractor = start(composition(video, lazy, MONTAGE));
      assertFrameAt(decode(extractor, 0.5), MONTAGE[0], 0.5, SLACK_US);
      assertFrameAt(decode(extractor, 4.5), MONTAGE[2], 4.5, SLACK_US);
      extractor.release();
      extractors.remove(extractor);
    }
  }

  /** Every exported frame, as the export asks for them. */
  private void walk(VideoComposition composition, Clip[] clips, boolean lazy) throws Exception {
    VideoCompositionFramesExtractorSync extractor = start(composition);
    VideoCompositionDecoder decoder =
      (VideoCompositionDecoder) Compositions.get(extractor, "decoder");
    int frames = (int) Math.round(composition.getDuration() * TestVideo.FPS);
    int maxOpen = 0;
    for (int i = 0; i < frames; i++) {
      double time = i / (double) TestVideo.FPS;
      Map<String, VideoFrame> decoded = decode(extractor, time);
      Clip current = clipAt(clips, time);
      assertNotNull(current);
      assertFrameAt(decoded, current, time, SLACK_US);
      int open = openCount(decoder, composition);
      maxOpen = Math.max(maxOpen, open);
      if (lazy) {
        for (Clip clip : clips) {
          if (!decoder.isOpen(Compositions.item(composition, clip.id))) {
            assertFalse(clip.id + " is closed but still has a frame at " + time + "s",
              decoded.containsKey(clip.id));
          }
        }
      }
    }
    if (lazy) {
      // A cut: the item before, kept 0.5 s past its end, and the one after,
      // opened 0.5 s ahead.
      assertTrue("up to " + maxOpen + " decoders open", maxOpen <= 2);
    } else {
      assertEquals(clips.length, maxOpen);
    }
  }

  private VideoCompositionFramesExtractorSync start(VideoComposition composition) throws Exception {
    VideoCompositionFramesExtractorSync extractor = new VideoCompositionFramesExtractorSync(composition);
    extractors.add(extractor);
    extractor.start();
    return extractor;
  }

  private Map<String, VideoFrame> decode(
    VideoCompositionFramesExtractorSync extractor, double time) throws Exception {
    Future<Map<String, VideoFrame>> frames =
      executor.submit(() -> new HashMap<>(extractor.decodeCompositionFrames(time)));
    try {
      return frames.get(10, TimeUnit.SECONDS);
    } catch (TimeoutException e) {
      frames.cancel(true);
      fail("No frames for " + time + "s after 10 s: the export would hang");
      return null;
    }
  }
}
