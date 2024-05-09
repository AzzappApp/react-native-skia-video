package com.azzapp.rnskv;

public class TimeHelpers {
  public static long secToUs(double sec) {
    return Math.round(sec * 1000000);
  }
}
