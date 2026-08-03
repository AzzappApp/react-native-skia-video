package com.azzapp.rnskv;

import android.net.Uri;
import android.os.Looper;
import android.os.SystemClock;

import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.PlaybackParameters;
import androidx.media3.common.Player;
import androidx.media3.common.Tracks;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.exoplayer.ExoPlayer;

import java.io.File;
import java.util.ArrayList;
import java.util.List;

/**
 * Plays the audio of the audio-enabled items of a video composition during
 * playback. One audio only ExoPlayer is created per audio-enabled item and
 * slaved to the composition clock through the {@link #update} method.
 * Every method must be called on the thread that called {@link #prepare}.
 */
@UnstableApi
public class AudioCompositionPlayer {

  public interface OnErrorListener {
    void onError(String message);
  }

  // Drift above which a player is hard-seeked (audible); smaller drifts are
  // caught up by adjusting the playback speed (pitch preserving, inaudible).
  private static final long HARD_RESYNC_US = 500000;

  // Speed adjustment hysteresis: starts above 60ms of drift, stops under 20ms.
  private static final long DRIFT_ADJUST_START_US = 60000;
  private static final long DRIFT_ADJUST_STOP_US = 20000;

  private static final float CATCH_UP_SPEED = 1.05f;
  private static final float SLOW_DOWN_SPEED = 0.95f;

  // Minimum delay between two hard resyncs of the same item; without it a
  // player whose seek latency exceeds the threshold re-seeks on every tick.
  private static final long RESYNC_COOLDOWN_MS = 1000;

  // Window after a start during which the observed drift is attributed to
  // the audio pipeline startup latency and learned as the seek lead.
  private static final long START_LEARN_WINDOW_MS = 2000;

  private static final long MAX_SEEK_LEAD_US = 1000000;

  private final VideoComposition composition;

  private final List<ItemPlayer> itemPlayers = new ArrayList<>();

  private OnErrorListener onErrorListener;

  private boolean released = false;

  public AudioCompositionPlayer(VideoComposition composition) {
    this.composition = composition;
  }

  public void setOnErrorListener(OnErrorListener onErrorListener) {
    this.onErrorListener = onErrorListener;
  }

  public void prepare() {
    for (VideoComposition.Item item : composition.getItems()) {
      if (!item.isAudioEnabled()) {
        continue;
      }
      itemPlayers.add(new ItemPlayer(item, this::dispatchError));
    }
  }

  private void dispatchError(String message) {
    if (!released && onErrorListener != null) {
      onErrorListener.onError(message);
    }
  }

  /**
   * Synchronizes the item players with the composition clock.
   */
  public void update(long positionUs, boolean isPlaying) {
    if (released) {
      return;
    }
    for (ItemPlayer itemPlayer : itemPlayers) {
      itemPlayer.update(positionUs, isPlaying);
    }
  }

  public void seekTo(long positionUs) {
    if (released) {
      return;
    }
    for (ItemPlayer itemPlayer : itemPlayers) {
      itemPlayer.seekTo(positionUs);
    }
  }

  public void pause() {
    if (released) {
      return;
    }
    for (ItemPlayer itemPlayer : itemPlayers) {
      itemPlayer.pause();
    }
  }

  public void release() {
    if (released) {
      return;
    }
    released = true;
    for (ItemPlayer itemPlayer : itemPlayers) {
      itemPlayer.release();
    }
    itemPlayers.clear();
  }

  private static class ItemPlayer {
    private final ExoPlayer player;
    private final long compositionStartTimeUs;
    private final long durationUs;

    // Learned seek/startup latency: seeking lands the player behind the
    // composition clock by the time the audio pipeline takes to resume,
    // leading every seek by the observed drift compensates it.
    private long seekLeadUs = 0;

    private long lastSyncElapsedMs = -1;

    private long lastStartElapsedMs = -1;

    private float currentSpeed = 1f;

    ItemPlayer(VideoComposition.Item item, OnErrorListener onErrorListener) {
      compositionStartTimeUs = TimeHelpers.secToUs(item.getCompositionStartTime());
      durationUs = TimeHelpers.secToUs(item.getDuration());

      player = new ExoPlayer.Builder(
        ReactNativeSkiaVideoModule.currentReactApplicationContext()
      ).setLooper(Looper.myLooper()).build();

      player.addListener(new Player.Listener() {
        private boolean audioTrackChecked = false;

        @Override
        public void onPlayerError(PlaybackException error) {
          onErrorListener.onError(error.getMessage());
        }

        @Override
        public void onTracksChanged(Tracks tracks) {
          if (item.isVideo() || audioTrackChecked || tracks.getGroups().isEmpty()) {
            return;
          }
          audioTrackChecked = true;
          for (Tracks.Group group : tracks.getGroups()) {
            if (group.getType() == C.TRACK_TYPE_AUDIO) {
              return;
            }
          }
          onErrorListener.onError("No audio track for path: " + item.getPath());
        }
      });

      String path = item.getPath();
      Uri uri = path.startsWith("/") ? Uri.fromFile(new File(path)) : Uri.parse(path);
      long startTimeMs = Math.round(item.getStartTime() * 1000);
      long endTimeMs = startTimeMs + Math.round(item.getDuration() * 1000);
      MediaItem mediaItem = new MediaItem.Builder()
        .setUri(uri)
        .setClippingConfiguration(
          new MediaItem.ClippingConfiguration.Builder()
            .setStartPositionMs(startTimeMs)
            .setEndPositionMs(endTimeMs)
            .build()
        )
        .build();
      player.setMediaItem(mediaItem);
      // Disabling video ensures a video file used as an audio source never
      // instantiates a video decoder.
      player.setTrackSelectionParameters(
        player.getTrackSelectionParameters().buildUpon()
          .setTrackTypeDisabled(C.TRACK_TYPE_VIDEO, true)
          .build()
      );
      player.setVolume((float) Math.max(0, Math.min(1, item.getAudioVolume())));
      player.setPlayWhenReady(false);
      player.prepare();
    }

    void update(long positionUs, boolean isPlaying) {
      long localPositionUs = positionUs - compositionStartTimeUs;
      boolean active =
        isPlaying && localPositionUs >= 0 && localPositionUs < durationUs;
      if (!active) {
        if (player.getPlayWhenReady()) {
          player.setPlayWhenReady(false);
        }
        return;
      }
      if (!player.getPlayWhenReady()) {
        // The player is usually already primed at the target position
        // (prepare, user seek, loop restart): starting it without seeking
        // avoids the seek + rebuffering latency at the start of playback.
        long playerPositionUs = player.getCurrentPosition() * 1000;
        long targetUs = localPositionUs + seekLeadUs;
        if (Math.abs(playerPositionUs - targetUs) > DRIFT_ADJUST_START_US) {
          syncTo(localPositionUs);
        }
        setSpeed(1f);
        player.setPlayWhenReady(true);
        lastStartElapsedMs = SystemClock.elapsedRealtime();
        lastSyncElapsedMs = lastStartElapsedMs;
        return;
      }
      if (!player.isPlaying()) {
        // Still buffering after a seek/start.
        return;
      }
      long playerPositionUs = player.getCurrentPosition() * 1000;
      long driftUs = localPositionUs - playerPositionUs;
      long absDriftUs = Math.abs(driftUs);
      long nowMs = SystemClock.elapsedRealtime();

      if (
        driftUs > 0
          && lastStartElapsedMs >= 0
          && nowMs - lastStartElapsedMs < START_LEARN_WINDOW_MS
      ) {
        seekLeadUs = Math.min(Math.max(seekLeadUs, driftUs), MAX_SEEK_LEAD_US);
      }

      if (absDriftUs > HARD_RESYNC_US) {
        if (lastSyncElapsedMs < 0 || nowMs - lastSyncElapsedMs >= RESYNC_COOLDOWN_MS) {
          syncTo(localPositionUs);
          setSpeed(1f);
        }
      } else if (absDriftUs > DRIFT_ADJUST_START_US) {
        setSpeed(driftUs > 0 ? CATCH_UP_SPEED : SLOW_DOWN_SPEED);
      } else if (absDriftUs < DRIFT_ADJUST_STOP_US) {
        setSpeed(1f);
      }
    }

    private void setSpeed(float speed) {
      if (currentSpeed != speed) {
        currentSpeed = speed;
        player.setPlaybackParameters(new PlaybackParameters(speed));
      }
    }

    void seekTo(long positionUs) {
      long localPositionUs =
        Math.max(0, Math.min(positionUs - compositionStartTimeUs, durationUs));
      syncTo(localPositionUs);
    }

    private void syncTo(long localPositionUs) {
      player.seekTo((localPositionUs + seekLeadUs) / 1000);
      lastSyncElapsedMs = SystemClock.elapsedRealtime();
    }

    void pause() {
      player.setPlayWhenReady(false);
    }

    void release() {
      player.release();
    }
  }
}
