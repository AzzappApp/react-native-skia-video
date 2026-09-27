package com.azzapp.rnskv;

import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import java.io.File;
import java.lang.reflect.Field;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Builds the compositions the tests play. The native side fills some fields
 * through JNI only; the tests set those by reflection.
 */
final class Compositions {

  private Compositions() {
  }

  /** An item: where it sits in the composition and where it reads the file. */
  static final class Clip {
    final String id;
    final double compositionStart;
    final double start;
    final double duration;

    Clip(String id, double compositionStart, double start, double duration) {
      this.id = id;
      this.compositionStart = compositionStart;
      this.start = start;
      this.duration = duration;
    }

    double end() {
      return compositionStart + duration;
    }

    boolean covers(double time) {
      return time >= compositionStart && time < end();
    }

    /** The file time shown at this composition time. */
    long sourceUs(double time) {
      return TimeHelpers.secToUs(start + time - compositionStart);
    }
  }

  /** Three 2 s clips back to back, each from a different part of the file. */
  static final Clip[] MONTAGE = {
    new Clip("a", 0, 0, 2),
    new Clip("b", 2, 1, 2),
    new Clip("c", 4, 2, 2),
  };

  static VideoComposition composition(File video, boolean lazy, Clip... clips) {
    List<VideoComposition.Item> items = new ArrayList<>();
    double duration = 0;
    for (Clip clip : clips) {
      items.add(new VideoComposition.Item(
        clip.id, video.getPath(), clip.compositionStart, clip.start, clip.duration));
      duration = Math.max(duration, clip.end());
    }
    VideoComposition composition = new VideoComposition(duration, items);
    if (lazy) {
      set(composition, "lazyDecoders", true);
    }
    return composition;
  }

  static VideoComposition.Item item(VideoComposition composition, String id) {
    for (VideoComposition.Item item : composition.getItems()) {
      if (item.getId().equals(id)) {
        return item;
      }
    }
    throw new IllegalArgumentException(id);
  }

  static Clip clipAt(Clip[] clips, double time) {
    for (Clip clip : clips) {
      if (clip.covers(time)) {
        return clip;
      }
    }
    return null;
  }

  static int openCount(VideoCompositionDecoder decoder, VideoComposition composition) {
    int open = 0;
    for (VideoComposition.Item item : composition.getItems()) {
      if (decoder.isOpen(item)) {
        open++;
      }
    }
    return open;
  }

  /**
   * The clip's frame is the last one at or before its file time, within
   * the given slack.
   */
  static void assertFrameAt(
    Map<String, VideoFrame> frames, Clip clip, double time, long slackUs) {
    VideoFrame frame = frames.get(clip.id);
    assertNotNull(clip.id + " has no frame at " + time + "s", frame);
    long expectedUs = clip.sourceUs(time);
    long actualUs = TimeHelpers.nsecToUs(frame.getTimestampNs());
    assertTrue(
      clip.id + " at " + time + "s shows " + actualUs + "us, expected about " + expectedUs + "us",
      actualUs <= expectedUs + slackUs && actualUs >= expectedUs - TestVideo.FRAME_US - slackUs);
  }

  static void set(Object target, String name, Object value) {
    try {
      Field field = target.getClass().getDeclaredField(name);
      field.setAccessible(true);
      field.set(target, value);
    } catch (ReflectiveOperationException e) {
      throw new AssertionError(e);
    }
  }

  static Object get(Object target, String name) {
    try {
      Field field = target.getClass().getDeclaredField(name);
      field.setAccessible(true);
      return field.get(target);
    } catch (ReflectiveOperationException e) {
      throw new AssertionError(e);
    }
  }
}
