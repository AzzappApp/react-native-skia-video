package com.azzapp.rnskv;

import static org.junit.Assert.assertArrayEquals;

import org.junit.Test;

public class FrameSizeTest {

  @Test
  public void capsTheLongSide() {
    assertArrayEquals(new int[]{1280, 720}, FrameSize.of(0, 0, 1280, 3840, 2160, 0));
  }

  @Test
  public void swapsForAQuarterTurn() {
    assertArrayEquals(new int[]{720, 1280}, FrameSize.of(0, 0, 1280, 3840, 2160, 90));
    assertArrayEquals(new int[]{720, 1280}, FrameSize.of(0, 0, 1280, 3840, 2160, 270));
  }

  @Test
  public void keepsTheFileSizeWithoutACap() {
    assertArrayEquals(new int[]{3840, 2160}, FrameSize.of(0, 0, 0, 3840, 2160, 0));
    assertArrayEquals(new int[]{1920, 1080}, FrameSize.of(-1, -1, -1, 1920, 1080, 0));
  }

  @Test
  public void neverUpscales() {
    assertArrayEquals(new int[]{1920, 1080}, FrameSize.of(0, 0, 4096, 1920, 1080, 0));
    assertArrayEquals(new int[]{1920, 1080}, FrameSize.of(0, 0, 1920, 1920, 1080, 0));
  }

  @Test
  public void anExplicitResolutionWins() {
    assertArrayEquals(new int[]{640, 360}, FrameSize.of(640, 360, 1280, 3840, 2160, 0));
    assertArrayEquals(new int[]{360, 640}, FrameSize.of(640, 360, 0, 3840, 2160, 90));
  }

  @Test
  public void roundsToEvenSizes() {
    assertArrayEquals(new int[]{1000, 562}, FrameSize.of(0, 0, 1000, 2704, 1520, 0));
    assertArrayEquals(new int[]{1920, 1080}, FrameSize.of(0, 0, 1920, 5312, 2988, 0));
    assertArrayEquals(new int[]{2, 2}, FrameSize.of(0, 0, 2, 4000, 10, 0));
  }
}
