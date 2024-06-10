package com.azzapp.rnskv;

import java.util.List;

/**
 * A class that represents a video composition.
 */
public class VideoComposition {

  private final List<Item> items;

  private final double duration;

  public VideoComposition(
    double duration,
    List<Item> items
  ) {
    this.duration = duration;
    this.items = items;
  }

  public List<Item> getItems() {
    return items;
  }

  public double getDuration() {
    return duration;
  }

  public static class Item {
    private String id;
    private String path;
    private double compositionStartTime;
    private double startTime;
    private double duration;
    private int width = -1;
    private int height = -1;

    public Item() {
    }

    public Item(
      String id,
      String path,
      double compositionStartTime,
      double startTime,
      double duration
    ) {
      this.id = id;
      this.path = path;
      this.compositionStartTime = compositionStartTime;
      this.startTime = startTime;
      this.duration = duration;
    }

    public String getId() {
      return id;
    }

    public String getPath() {
      return path;
    }

    public double getCompositionStartTime() {
      return compositionStartTime;
    }

    public double getStartTime() {
      return startTime;
    }

    public double getDuration() {
      return duration;
    }

    public int getWidth() {
      return width;
    }

    public int getHeight() {
      return height;
    }
  }
}
