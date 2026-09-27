package com.azzapp.rnskv;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.Random;

import org.junit.Test;

public class DecoderWindowTest {

  private static final DecoderWindow EAGER = DecoderWindow.of(false, true);
  private static final DecoderWindow PREVIEW = DecoderWindow.of(true, true);
  private static final DecoderWindow EXPORT = DecoderWindow.of(true, false);

  private static long s(double seconds) {
    return Math.round(seconds * 1e6);
  }

  @Test
  public void withoutLazyDecodersEverythingIsOpen() {
    assertTrue(EAGER.opens(s(10), s(20), s(50)));
    assertTrue(EAGER.keeps(s(10), s(20), s(50)));
  }

  @Test
  public void thePreviewOpensAheadOfTheItem() {
    assertTrue(PREVIEW.opens(s(10), s(20), s(8.5)));
    assertFalse(PREVIEW.opens(s(10), s(20), s(8.4)));
    assertTrue(PREVIEW.opens(s(10), s(20), s(19.99)));
    assertFalse(PREVIEW.opens(s(10), s(20), s(20)));
  }

  @Test
  public void theExportOpensJustAhead() {
    assertTrue(EXPORT.opens(s(10), s(20), s(9.5)));
    assertFalse(EXPORT.opens(s(10), s(20), s(9.4)));
    assertTrue(EXPORT.opens(0, s(5), 0));
  }

  @Test
  public void itemsAreKeptALittlePastBothEdges() {
    assertTrue(PREVIEW.keeps(s(10), s(20), s(8.0)));
    assertFalse(PREVIEW.keeps(s(10), s(20), s(7.99)));
    assertTrue(PREVIEW.keeps(s(10), s(20), s(20.4)));
    assertFalse(PREVIEW.keeps(s(10), s(20), s(20.5)));
  }

  @Test
  public void noReadAheadOverTheLoopWrap() {
    assertFalse(PREVIEW.opens(0, s(5), s(59)));
  }

  // Otherwise an item could be opened and closed at the same position.
  @Test
  public void opensImpliesKeeps() {
    Random random = new Random(1);
    for (int i = 0; i < 200_000; i++) {
      long start = (long) (random.nextDouble() * s(55));
      long end = start + s(0.5) + (long) (random.nextDouble() * s(10));
      long position = (long) (random.nextDouble() * s(62)) - s(1);
      for (DecoderWindow window : new DecoderWindow[]{PREVIEW, EXPORT}) {
        if (window.opens(start, end, position)) {
          assertTrue(window.keeps(start, end, position));
        }
      }
    }
  }
}
