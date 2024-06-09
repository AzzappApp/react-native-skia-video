package com.azzapp.rnskv;

public class TimeHelpers {
  public static long secToUs(double sec) {
    return Math.round(sec * 1000000);
  }

  public static long nsecToUs(long nsec) {
    return Math.round(nsec / 1000);
  }
}
