package com.azzapp.rnskv;

import java.util.List;

/**
 * A class that represents a video composition.
 */
public class VideoComposition {

  private final List<Item> items;

  private final double duration;

  private boolean lazyDecoders = false;

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

  /**
   * @return whether decoders are opened around their item's time rather than
   * all at once, see {@link DecoderWindow}
   */
  public boolean isLazyDecoders() {
    return lazyDecoders;
  }

  /**
   * @return whether an item hands its decoder's buffers over directly
   */
  public boolean hasDirectTextures() {
    for (Item item : items) {
      if (item.isVideo() && item.isDirectTexture()) {
        return true;
      }
    }
    return false;
  }

  public boolean hasAudio() {
    for (Item item : items) {
      if (item.isAudioEnabled()) {
        return true;
      }
    }
    return false;
  }

  public static class Item {
    private String id;
    private String path;
    private double compositionStartTime;
    private double startTime;
    private double duration;
    private int width = -1;
    private int height = -1;
    private int maxLongSide = -1;
    // textureMode: 'direct', set from native code.
    private boolean directTexture = false;
    private boolean isVideo = true;
    private boolean audioEnabled = false;
    private double audioVolume = 1.0;

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

    public int getMaxLongSide() {
      return maxLongSide;
    }

    /**
     * @return whether the item's frames are the decoder's own buffers, handed
     * over without a copy (`textureMode: 'direct'`)
     */
    public boolean isDirectTexture() {
      return directTexture;
    }

    public boolean isVideo() {
      return isVideo;
    }

    public boolean isAudioEnabled() {
      return audioEnabled;
    }

    public double getAudioVolume() {
      return audioVolume;
    }
  }
}
