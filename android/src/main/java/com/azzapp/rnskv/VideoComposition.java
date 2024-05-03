package com.azzapp.rnskv;

import java.util.List;

/**
 * A class that represents a video composition.
 */
public class VideoComposition {

  private final List<Item> items;

  private final long duration;

  public VideoComposition(
    long duration,
    List<Item> items
  )  {
    this.duration = duration;
    this.items = items;
  }

  public List<Item> getItems() {
    return items;
  }

  public long getDuration() {
    return duration;
  }

  public static class Item {
    private String id;

    private String path;

    private long compositionStartTime;

    private long compositionEndTime;

    public Item() {}

    public Item(
      String id,
      String path,
      long compositionStartTime,
      long compositionEndTime
    ) {
      this.id = id;
      this.path = path;
      this.compositionStartTime = compositionStartTime;
      this.compositionEndTime = compositionEndTime;
    }

    public String getId() {
      return id;
    }

    public String getPath() {
      return path;
    }

    public long getCompositionStartTime() {
      return compositionStartTime;
    }

    public long getCompositionEndTime() {
      return compositionEndTime;
    }
  }
}
