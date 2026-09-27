package com.azzapp.rnskv;

import static com.azzapp.rnskv.Compositions.MONTAGE;
import static com.azzapp.rnskv.Compositions.assertFrameAt;
import static com.azzapp.rnskv.Compositions.clipAt;
import static com.azzapp.rnskv.Compositions.composition;
import static com.azzapp.rnskv.Compositions.openCount;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import android.os.Handler;
import android.os.HandlerThread;
import android.os.SystemClock;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import com.azzapp.rnskv.Compositions.Clip;

import org.junit.After;
import org.junit.BeforeClass;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.io.File;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import javax.microedition.khronos.egl.EGL10;

/**
 * The preview's path: VideoCompositionDecoder in real time, driven as
 * VideoCompositionFramesExtractor drives it. The test thread is the GL thread
 * that asks for frames; a handler thread plays, ticking every 10 ms.
 */
@RunWith(AndroidJUnit4.class)
public class CompositionPreviewTest {

  // Playing: the frame lags the clock by a tick, a latch and a slow emulator.
  private static final long PLAYING_SLACK_US = 250_000;

  // Paused after a seek: the exact frame.
  private static final long PAUSED_SLACK_US = 1_000;

  private static File video;

  private EGLResourcesHolder gl;

  private VideoComposition composition;

  private VideoCompositionDecoder decoder;

  private HandlerThread playback;

  private Handler handler;

  private final List<Exception> errors = Collections.synchronizedList(new ArrayList<>());

  private volatile long positionUs = 0;

  private volatile boolean playing = false;

  private volatile long clockStartNs = 0;

  private final Runnable tick = new Runnable() {
    @Override
    public void run() {
      if (playing) {
        positionUs = (System.nanoTime() - clockStartNs) / 1000;
      }
      decoder.updateWindow(positionUs);
      decoder.render(positionUs);
      handler.postDelayed(this, 10);
    }
  };

  @BeforeClass
  public static void writeVideo() throws Exception {
    File cache = InstrumentationRegistry.getInstrumentation().getTargetContext().getCacheDir();
    video = TestVideo.write(new File(cache, "preview-test.mp4"), 6);
  }

  @After
  public void stop() throws Exception {
    if (playback != null) {
      handler.removeCallbacksAndMessages(null);
      playback.quitSafely();
      playback.join(2000);
    }
    if (decoder != null) {
      decoder.release();
    }
    if (gl != null) {
      gl.release();
    }
    assertTrue("decoder errors: " + errors, errors.isEmpty());
  }

  @Test
  public void anEagerMontagePlaysThrough() throws Exception {
    open(false);
    playThrough(MONTAGE.length, true);
  }

  @Test
  public void aLazyMontagePlaysThroughWithFewDecoders() throws Exception {
    open(true);
    // At most the item before, kept past its end, the one on screen, and the
    // one after, opened ahead.
    playThrough(3, false);
  }

  @Test
  public void aSeekIntoAClosedItemShowsItsFrame() throws Exception {
    open(true);
    awaitFrame(MONTAGE[0], 0);
    assertFalse(decoder.isOpen(Compositions.item(composition, "c")));
    seek(5.0);
    awaitFrame(MONTAGE[2], 5.0);
    seek(0.5);
    awaitFrame(MONTAGE[0], 0.5);
    seek(2.5);
    awaitFrame(MONTAGE[1], 2.5);
  }

  @Test
  public void aScrubSettlesOnTheRightFrame() throws Exception {
    open(true);
    Random random = new Random(7);
    for (int i = 0; i < 60; i++) {
      seek(random.nextDouble() * composition.getDuration());
      pump();
      assertTrue(openCount(decoder, composition) <= 3);
      SystemClock.sleep(15);
    }
    seek(4.2);
    awaitFrame(MONTAGE[2], 4.2);
  }

  @Test
  public void releaseStopsTheDecoderThreads() throws Exception {
    open(true);
    play();
    long until = SystemClock.uptimeMillis() + 1000;
    while (SystemClock.uptimeMillis() < until) {
      pump();
      SystemClock.sleep(16);
    }
    handler.removeCallbacksAndMessages(null);
    playback.quitSafely();
    playback.join(2000);
    playback = null;
    decoder.release();
    decoder = null;
    long deadline = SystemClock.uptimeMillis() + 3000;
    while (decoderThreadsAlive() && SystemClock.uptimeMillis() < deadline) {
      SystemClock.sleep(50);
    }
    assertFalse("opener or codec thread still alive after release()", decoderThreadsAlive());
  }

  private void open(boolean lazy) throws Exception {
    composition = composition(video, lazy, MONTAGE);
    gl = EGLResourcesHolder.createWithPBBufferSurface(EGL10.EGL_NO_CONTEXT);
    gl.makeCurrent();
    decoder = new VideoCompositionDecoder(composition, true);
    decoder.setOnErrorListener(errors::add);
    decoder.setOnOpenErrorListener(errors::add);
    decoder.prepare(EGLUtils.getCurrentContextOrThrows());
    playback = new HandlerThread("test-playback");
    playback.start();
    handler = new Handler(playback.getLooper());
    onPlayback(decoder::start);
    handler.post(tick);
  }

  private void playThrough(int maxOpenAllowed, boolean allOpen) throws Exception {
    play();
    int checks = 0;
    int maxOpen = 0;
    long endUs = TimeHelpers.secToUs(composition.getDuration()) - 100_000;
    while (positionUs < endUs) {
      Map<String, VideoFrame> frames = pump();
      double time = positionUs / 1e6;
      Clip clip = clipAt(MONTAGE, time);
      // Clear of the cut, where "on screen" depends on which thread looked.
      if (clip != null && time - clip.compositionStart > 0.3 && clip.end() - time > 0.1) {
        assertFrameAt(frames, clip, time, PLAYING_SLACK_US);
        checks++;
      }
      maxOpen = Math.max(maxOpen, openCount(decoder, composition));
      SystemClock.sleep(16);
    }
    assertTrue("only " + checks + " frames checked", checks > 50);
    assertTrue("up to " + maxOpen + " decoders open", maxOpen <= maxOpenAllowed);
    if (allOpen) {
      assertEquals(MONTAGE.length, maxOpen);
    }
  }

  private void awaitFrame(Clip clip, double time) {
    long deadline = SystemClock.uptimeMillis() + 3000;
    AssertionError last = null;
    while (SystemClock.uptimeMillis() < deadline) {
      try {
        assertFrameAt(pump(), clip, time, PAUSED_SLACK_US);
        return;
      } catch (AssertionError e) {
        last = e;
      }
      SystemClock.sleep(10);
    }
    throw last != null ? last : new AssertionError("no frame for " + clip.id);
  }

  private Map<String, VideoFrame> pump() {
    return new HashMap<>(decoder.updateVideosFrames());
  }

  private void play() throws Exception {
    onPlayback(() -> {
      clockStartNs = System.nanoTime() - positionUs * 1000;
      playing = true;
    });
  }

  /** As VideoCompositionFramesExtractor#seekInternal does it. */
  private void seek(double seconds) throws Exception {
    long position = TimeHelpers.secToUs(seconds);
    onPlayback(() -> {
      decoder.seekTo(position);
      decoder.updateWindow(position);
      positionUs = position;
      clockStartNs = System.nanoTime() - position * 1000;
    });
  }

  private void onPlayback(Runnable runnable) throws Exception {
    CountDownLatch done = new CountDownLatch(1);
    handler.post(() -> {
      try {
        runnable.run();
      } finally {
        done.countDown();
      }
    });
    if (!done.await(5, TimeUnit.SECONDS)) {
      fail("the playback thread is stuck");
    }
  }

  private static boolean decoderThreadsAlive() {
    for (Thread thread : Thread.getAllStackTraces().keySet()) {
      String name = thread.getName();
      if (thread.isAlive()
        && (name.equals("ReactNativeSkiaVideo-Opener") || name.equals("ReactNativeSkiaVideo-Codecs"))) {
        return true;
      }
    }
    return false;
  }
}
