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

  public boolean hasAudio() {
    for (Item item : items) {
      if (item.isAudioEnabled()) {
        return true;
      }
    }
    return false;
  }

  public static class Item {
    /**
     * How long before it starts and after it ends an item is live (see {@link #isLiveAt}).
     */
    public static final long LIVE_MARGIN_US = 1_000_000;

    private String id;
    private String path;
    private double compositionStartTime;
    private double startTime;
    private double duration;
    private int width = -1;
    private int height = -1;
    // Cap on the decoded long side, resolved against the decoder's own frame
    // size (see types.ts): unlike width/height it says nothing about
    // orientation, so a caller holding display dimensions cannot get it wrong.
    private double maxLongSide = 0;
    private boolean isVideo = true;
    private boolean audioEnabled = false;
    private double audioVolume = 1.0;
    // Fades of an audio item, in seconds (see types.ts).
    private double audioFadeIn = 0;
    private double audioFadeOut = 0;

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

    public double getMaxLongSide() {
      return maxLongSide;
    }

    public boolean isVideo() {
      return isVideo;
    }

    /**
     * Whether the item is live at a time of the composition: from {@link #LIVE_MARGIN_US} before
     * it starts to {@link #LIVE_MARGIN_US} after it ends. Its frames are only handed out then,
     * the resources of the frames of an item that is not live can be released.
     */
    public boolean isLiveAt(long compositionTimeUs) {
      long startUs = TimeHelpers.secToUs(compositionStartTime);
      long endUs = TimeHelpers.secToUs(compositionStartTime + duration);
      return compositionTimeUs >= startUs - LIVE_MARGIN_US
        && compositionTimeUs <= endUs + LIVE_MARGIN_US;
    }

    public boolean isAudioEnabled() {
      return audioEnabled;
    }

    public double getAudioVolume() {
      return audioVolume;
    }

    /**
     * The volume of the item at a time of the item (seconds from its start):
     * its volume, ramped by its fades. The fades are clamped to the item, the
     * fade out to what the fade in leaves of it.
     */
    public double getAudioVolumeAt(double localTime) {
      double volume = Math.max(0, Math.min(1, audioVolume));
      double fadeIn = Math.max(0, Math.min(audioFadeIn, duration));
      double fadeOut = Math.max(0, Math.min(audioFadeOut, duration - fadeIn));
      double gain = 1;
      if (fadeIn > 0) {
        gain = Math.min(gain, localTime / fadeIn);
      }
      if (fadeOut > 0) {
        gain = Math.min(gain, (duration - localTime) / fadeOut);
      }
      return volume * Math.max(0, Math.min(1, gain));
    }
  }
}
