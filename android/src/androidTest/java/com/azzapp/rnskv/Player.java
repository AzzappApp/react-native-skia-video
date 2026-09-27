package com.azzapp.rnskv;

import static org.junit.Assert.assertTrue;

import android.os.SystemClock;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Predicate;

import javax.microedition.khronos.egl.EGL10;

/**
 * The real preview player, VideoCompositionFramesExtractor, with its own
 * playback thread and loop; the test thread draws, as the UI thread does in
 * the app. Its events are recorded instead of reaching JS.
 */
final class Player implements AutoCloseable {

  final VideoComposition composition;

  final VideoCompositionFramesExtractor extractor;

  final List<String> events = Collections.synchronizedList(new ArrayList<>());

  final List<String> errors = Collections.synchronizedList(new ArrayList<>());

  private final EGLResourcesHolder gl;

  Player(VideoComposition composition) {
    this.composition = composition;
    gl = EGLResourcesHolder.createWithPBBufferSurface(EGL10.EGL_NO_CONTEXT);
    gl.makeCurrent();
    extractor = new VideoCompositionFramesExtractor(composition, new NativeEventDispatcher(0) {
      @Override
      public void dispatchEvent(String eventName, Object data) {
        events.add(eventName);
        if (eventName.equals("error")) {
          errors.add(String.valueOf(data));
        }
      }
    });
    extractor.prepare();
    awaitEvent("ready", 5000);
  }

  void awaitEvent(String name, long timeoutMs) {
    long deadline = SystemClock.uptimeMillis() + timeoutMs;
    while (!events.contains(name) && SystemClock.uptimeMillis() < deadline) {
      frames();
      SystemClock.sleep(10);
    }
    assertTrue("no " + name + " event after " + timeoutMs + "ms, got " + events, events.contains(name));
  }

  /** Draws as the UI thread does, one vsync. */
  Map<String, VideoFrame> frames() {
    return new HashMap<>(extractor.decodeCompositionFrames());
  }

  double position() {
    return extractor.getCurrentPosition() / 1e6;
  }

  void seek(double seconds) {
    extractor.seekTo(TimeHelpers.secToUs(seconds));
  }

  /**
   * Draws until the frames pass the check, or fails with the last reason.
   */
  Map<String, VideoFrame> drawUntil(String what, long timeoutMs, Predicate<Map<String, VideoFrame>> check) {
    long deadline = SystemClock.uptimeMillis() + timeoutMs;
    Map<String, VideoFrame> frames = frames();
    while (!check.test(frames)) {
      if (SystemClock.uptimeMillis() > deadline) {
        throw new AssertionError(what + " after " + timeoutMs + "ms, position "
          + position() + "s, frames " + describe(frames) + ", events " + events);
      }
      SystemClock.sleep(8);
      frames = frames();
    }
    return frames;
  }

  static String describe(Map<String, VideoFrame> frames) {
    StringBuilder builder = new StringBuilder("{");
    frames.forEach((id, frame) -> builder.append(id).append('=')
      .append(frame == null ? "null" : TimeHelpers.nsecToUs(frame.getTimestampNs()) + "us").append(' '));
    return builder.append('}').toString();
  }

  @Override
  public void close() {
    extractor.release();
    long deadline = SystemClock.uptimeMillis() + 3000;
    while (threadAlive() && SystemClock.uptimeMillis() < deadline) {
      SystemClock.sleep(20);
    }
    gl.release();
  }

  static boolean threadAlive() {
    for (Thread thread : Thread.getAllStackTraces().keySet()) {
      String name = thread.getName();
      if (thread.isAlive() && (name.startsWith("ReactNativeSkiaVideo")
        || name.contains("PlaybackThread"))) {
        return true;
      }
    }
    return false;
  }
}
