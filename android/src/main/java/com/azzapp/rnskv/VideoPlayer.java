package com.azzapp.rnskv;

import android.net.Uri;
import android.os.Handler;
import android.os.Looper;

import androidx.annotation.NonNull;
import androidx.media3.common.Format;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.VideoSize;
import androidx.media3.common.PlaybackParameters;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.exoplayer.ExoPlayer;

/**
 * A class that wraps ExoPlayer to play video, and hands out its frames in the decoder's own YUV
 * buffers (see {@link ImageReaderFrameExtractor}).
 */
@UnstableApi
public class VideoPlayer {

  private ExoPlayer player;

  private final Handler mainHandler = new Handler(Looper.getMainLooper());

  private boolean isInitialized = false;

  private float volume = 1f;

  private float playbackSpeed = 1f;

  private long duration = 0L;

  private long currentPosition = 0L;

  private boolean isPlaying = false;

  private Boolean isLooping = false;

  private boolean isSeeking = false;

  // Ready, but the size of the video is not known yet: the ready event is
  // dispatched once it is.
  private boolean readyPending = false;

  /**
   * The default size of the reader's buffers: the decoder sets the size of its own.
   */
  private static final int DEFAULT_BUFFER_WIDTH = 1920;
  private static final int DEFAULT_BUFFER_HEIGHT = 1080;

  // Created and read on the main thread, as the player.
  private ImageReaderFrameExtractor frameExtractor;

  // The size of the video once rotated, as the player reports it.
  private int videoWidth;
  private int videoHeight;

  private final int outputWidth;
  private final int outputHeight;
  private final double maxLongSide;

  private volatile boolean released = false;

  private final NativeEventDispatcher eventDispatcher;

  /**
   * Create a new VideoPlayer with the given URI
   */
  @UnstableApi
  public VideoPlayer(
    String uriStr,
    int width,
    int height,
    double maxLongSide,
    NativeEventDispatcher eventDispatcher
  ) {
    this.eventDispatcher = eventDispatcher;
    outputWidth = width;
    outputHeight = height;
    this.maxLongSide = maxLongSide;
    mainHandler.post(() -> {
      if (released) {
        return;
      }
      player = new ExoPlayer.Builder(ReactNativeSkiaVideoModule.currentReactApplicationContext()).build();
      // Its listener runs on the looper of this thread, the main one: decodeNextFrame is called
      // on it too.
      frameExtractor = new ImageReaderFrameExtractor(DEFAULT_BUFFER_WIDTH, DEFAULT_BUFFER_HEIGHT);
      player.setVideoSurface(frameExtractor.getSurface());

      MediaItem mediaItem = new MediaItem.Builder().setUri(Uri.parse(uriStr)).build();
      player.setMediaItem(mediaItem);

      player.addListener(new Player.Listener() {
        private boolean isBuffering = false;

        public void setBuffering(boolean buffering) {
          if (isBuffering != buffering) {
            isBuffering = buffering;
            dispatchEventIfNoReleased(isBuffering ? "bufferingStart" : "bufferingEnd", null);
          }
        }

        @Override
        public void onPlaybackStateChanged(final int playbackState) {
          if (released) {
            return;
          }
          if (playbackState == Player.STATE_BUFFERING) {
            setBuffering(true);
          } else if (playbackState == Player.STATE_READY) {
            if (!isInitialized) {
              isInitialized = true;
              duration = player.getDuration();
              // Unknown (0x0) until the first frame is decoded: then
              // updated by onVideoSizeChanged.
              VideoSize videoSize = player.getVideoSize();
              videoHeight = videoSize.height;
              videoWidth = videoSize.width;
              updateCurrentPosition();
              if (videoWidth > 0 && videoHeight > 0) {
                dispatchReady();
              } else {
                readyPending = true;
              }
            }
            if (isSeeking) {
              isSeeking = false;
              dispatchEventIfNoReleased("seekComplete", null);
            }
          } else if (playbackState == Player.STATE_ENDED) {
            dispatchEventIfNoReleased("complete", null);
          }

          if (playbackState != Player.STATE_BUFFERING) {
            setBuffering(false);
          }
        }

        @Override
        public void onVideoSizeChanged(@NonNull VideoSize videoSize) {
          // The player can be ready before it knows the size of the video:
          // no frame would be decoded with the size read then (0x0).
          if (videoSize.width > 0 && videoSize.height > 0) {
            videoWidth = videoSize.width;
            videoHeight = videoSize.height;
            if (readyPending) {
              readyPending = false;
              dispatchReady();
            }
          }
        }

        @Override
        public void onPlayerError(@NonNull final PlaybackException error) {
          setBuffering(false);
          if (error.errorCode == PlaybackException.ERROR_CODE_BEHIND_LIVE_WINDOW) {
            // See https://exoplayer.dev/live-streaming.html#behindlivewindowexception-and-error_code_behind_live_window
            player.seekToDefaultPosition();
            player.prepare();
          } else {
            dispatchEventIfNoReleased("error", error.getMessage());
          }
        }

        @Override
        public void onIsPlayingChanged(boolean playing) {
          isPlaying = playing;
          dispatchEventIfNoReleased("playingStatusChange", playing);
        }
      });

      player.prepare();

      dispatchBufferingUpdate();
    });
  }

  long previousBufferedPosition = 0;

  private void dispatchReady() {
    dispatchEventIfNoReleased("ready", new int[]{videoWidth, videoHeight, 0});
  }

  private void dispatchBufferingUpdate() {
    if (released || player == null) {
      return;
    }
    long bufferedPosition = player.getBufferedPosition();
    if (bufferedPosition != previousBufferedPosition) {
      previousBufferedPosition = bufferedPosition;
      dispatchEventIfNoReleased("bufferingUpdate", bufferedPosition);
    }
    mainHandler.postDelayed(this::dispatchBufferingUpdate, 500);
  }

  private void updateCurrentPosition() {
    if (released || player == null) {
      return;
    }
    this.currentPosition = player.getCurrentPosition();
    mainHandler.postDelayed(this::updateCurrentPosition, 50);
  }

  /**
   * Start playing the video
   */
  public void play() {
    mainHandler.post(() -> player.play());
  }

  /**
   * Pause the video
   */
  public void pause() {
    mainHandler.post(() -> player.pause());
  }

  /**
   * Seek to a specific location in the video
   */
  public void seekTo(long location) {
    isSeeking = true;
    mainHandler.post(() -> player.seekTo(location));
  }

  /**
   * @return whether the video is playing
   */
  public boolean getIsPlaying() {
    return isPlaying;
  }

  /**
   * @return the current position in the video
   */
  public long getCurrentPosition() {
    return currentPosition;
  }

  /**
   * @return the duration of the video
   */
  public long getDuration() {
    return duration;
  }

  /**
   * @return the volume of the video between 0 and 1
   */
  public float getVolume() {
    return volume;
  }

  /**
   * Set the volume of the video
   *
   * @param value the volume to set between 0 and 1
   */
  public void setVolume(float value) {
    volume = value;
    mainHandler.post(() -> player.setVolume(Math.max(0f, Math.min(1f, value))));
  }

  /**
   * @return whether the video is looping
   */
  public boolean getIsLooping() {
    return isLooping;
  }

  /**
   * Set whether the video should loop
   *
   * @param value whether the video should loop
   */
  public void setIsLooping(boolean value) {
    isLooping = value;
    mainHandler.post(() -> player.setRepeatMode(value ? Player.REPEAT_MODE_ALL : Player.REPEAT_MODE_OFF));
  }

  /**
   * @return the playback speed of the video
   */
  public float getPlaybackSpeed() {
    return playbackSpeed;
  }

  /**
   * Set the playback speed of the video
   *
   * @param value the playback speed to set (must be greater than 0)
   */
  public void setPlaybackSpeed(float value) {
    playbackSpeed = Math.max(0.1f, value); // Minimum speed of 0.1x
    mainHandler.post(() -> {
      if (player != null) {
        player.setPlaybackParameters(new PlaybackParameters(playbackSpeed, 1.0f));
      }
    });
  }

  /**
   * Hands out the latest frame the player rendered, if it is new.
   *
   * @return the frame, or null if there is no new one
   */
  public VideoFrame decodeNextFrame() {
    if (Looper.myLooper() != Looper.getMainLooper()) {
      throw new RuntimeException("decodeNextFrame should be called on UI Thread");
    }
    if (released || player == null || frameExtractor == null) {
      return null;
    }
    // The decoder renders the frames as stored, JS rotates them: the size the player reports
    // (videoWidth × videoHeight) is the rotated one.
    Format format = player.getVideoFormat();
    if (format == null) {
      return null;
    }
    boolean downscale = outputWidth > 0 && outputHeight > 0;
    int width = downscale ? outputWidth : videoWidth;
    int height = downscale ? outputHeight : videoHeight;
    if (!downscale && maxLongSide > 0) {
      // The long side does not depend on the orientation: the size the player
      // reports (already rotated) is scaled as is.
      int longSide = Math.max(width, height);
      if (longSide > maxLongSide) {
        // Even sizes, as the frames of a composition (4:2:0 video).
        double scale = maxLongSide / longSide;
        width = Math.max(2, 2 * (int) Math.round(width * scale / 2));
        height = Math.max(2, 2 * (int) Math.round(height * scale / 2));
      }
    }
    if (width <= 0 || height <= 0 || !frameExtractor.decodeNextFrame()) {
      return null;
    }
    int rotation = format.rotationDegrees;
    // The size of the video as stored, before its rotation.
    boolean swapped = rotation == 90 || rotation == 270;
    int storedWidth = swapped ? videoHeight : videoWidth;
    int storedHeight = swapped ? videoWidth : videoHeight;
    return new VideoFrame(
      frameExtractor.getOutputBuffer(),
      width,
      height,
      frameExtractor.getLatestTimeStampNs(),
      frameExtractor.getCropRect(storedWidth, storedHeight),
      rotation
    );
  }

  /**
   * Release the video player and its resources
   */
  public void release() {
    released = true;
    mainHandler.post(() -> {
      if (player != null) {
        player.stop();
        player.release();
        player = null;
      }
      // Once the decoder is released.
      if (frameExtractor != null) {
        frameExtractor.release();
        frameExtractor = null;
      }
    });
  }

  private void dispatchEventIfNoReleased(String eventName, Object value) {
    if (released) {
      return;
    }
    eventDispatcher.dispatchEvent(eventName, value);
  }
}
