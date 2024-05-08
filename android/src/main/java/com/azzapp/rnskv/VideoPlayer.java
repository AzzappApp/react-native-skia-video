package com.azzapp.rnskv;

import android.graphics.ImageFormat;
import android.hardware.HardwareBuffer;
import android.media.Image;
import android.media.ImageReader;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;

import androidx.annotation.NonNull;
import androidx.media3.common.Format;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.util.Log;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.exoplayer.ExoPlayer;

import java.util.HashMap;
import java.util.Map;

/**
 * A class that wraps ExoPlayer to play video, and extract frames from it using OpenGL
 */
public class VideoPlayer {

  private ExoPlayer player;

  private final Handler mainHandler = new Handler(Looper.getMainLooper());

  private boolean isInitialized = false;

  private float volume = 1f;

  private long duration = 0L;

  private long currentPosition = 0L;

  private boolean isPlaying = false;

  private Boolean isLooping = false;

  private boolean isSeeking = false;

  private ImageReader imageReader;

  private HardwareBuffer currentBuffer;

  private boolean released = false;

  private final NativeEventDispatcher eventDispatcher;

  /**
   * Create a new VideoPlayer with the given URI
   */
  @UnstableApi
  public VideoPlayer(String uriStr, NativeEventDispatcher eventDispatcher)  {
    this.eventDispatcher = eventDispatcher;
    mainHandler.post(() -> {
      if (released) {
        return;
      }
      player = new ExoPlayer.Builder(ReactNativeSkiaVideoModule.currentReactApplicationContext()).build();

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
              Format videoFormat = player.getVideoFormat();
              createImageReader(videoFormat);
              updateCurrentPosition();

              dispatchEventIfNoReleased("ready", new int[] {
                videoFormat.width, videoFormat.height, videoFormat.rotationDegrees});
            }
            if(isSeeking) {
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
  private void dispatchBufferingUpdate() {
    if (released || player == null) {
      return;
    }
    long bufferedPosition = player.getBufferedPosition();
    if (bufferedPosition != previousBufferedPosition) {
      previousBufferedPosition = bufferedPosition;
      dispatchEventIfNoReleased("bufferingUpdate", bufferedPosition);
    }
    mainHandler.postDelayed(() -> { dispatchBufferingUpdate(); }, 500);
  }

  private void updateCurrentPosition() {
    if (released || player == null) {
      return;
    }
    this.currentPosition =  player.getCurrentPosition();
    mainHandler.postDelayed(() -> { updateCurrentPosition(); }, 50);
  }

  private void createImageReader(Format format) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      imageReader = ImageReader.newInstance(
        format.width,
        format.height,
        ImageFormat.PRIVATE,
        2,
        HardwareBuffer.USAGE_GPU_SAMPLED_IMAGE
      );
    } else {
      imageReader = ImageReader.newInstance(format.width, format.height,
        ImageFormat.PRIVATE, 2);
    }
    player.setVideoSurface(imageReader.getSurface());
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
   * @param value whether the video should loop
   */
  public void setIsLooping(boolean value) {
    isLooping = value;
    mainHandler.post(() -> player.setRepeatMode(value ? Player.REPEAT_MODE_ALL : Player.REPEAT_MODE_OFF));
  }

  /**
   * Decode the next frame of the video
   * @return whether the frame was decoded successfully
   */
  @UnstableApi
  public VideoFrame decodeNextFrame() {
    if (Looper.myLooper() != Looper.getMainLooper()) {
      throw new RuntimeException("decodeNextFrame should be called on UI Thread");
    }
    if (imageReader == null) {
      return null;
    }
    Image image = imageReader.acquireLatestImage();
    if (image == null) {
      return null;
    }
    HardwareBuffer buffer = image.getHardwareBuffer();
    image.close();
    if (buffer == null) {
      return null;
    }
    if (currentBuffer != null) {
      currentBuffer.close();
    }
    currentBuffer = buffer;

    Format format = player.getVideoFormat();
    return new VideoFrame(
      currentBuffer,
      format.width,
      format.height,
      format.rotationDegrees
    );
  }

  /**
   * Release the video player and its resources
   */
  public void release() {
    released = true;
    if (currentBuffer != null) {
      currentBuffer.close();
      currentBuffer = null;
    }
    if (imageReader != null) {
      imageReader.close();
      imageReader = null;
    }
    mainHandler.post(() -> {
      if (player != null) {
        player.stop();
        player.release();
        player = null;
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
