package com.azzapp.rnskv;

import android.net.Uri;
import android.os.Handler;
import android.os.Looper;

import androidx.annotation.NonNull;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.VideoSize;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.exoplayer.ExoPlayer;

import javax.microedition.khronos.egl.EGLContext;

/**
 * A class that wraps ExoPlayer to play video, and extract frames from it using OpenGL
 */
@UnstableApi
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

  private EGLResourcesHolder eglResourcesHolder;

  private GLFrameExtractor glFrameExtractor;

  private int videoWidth;
  private int videoHeight;

  private final int outputWidth;
  private final int outputHeight;

  private boolean released = false;

  private final NativeEventDispatcher eventDispatcher;

  /**
   * Create a new VideoPlayer with the given URI
   */
  @UnstableApi
  public VideoPlayer(String uriStr, int width, int height, NativeEventDispatcher eventDispatcher) {
    this.eventDispatcher = eventDispatcher;
    outputWidth = width;
    outputHeight = height;
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
              VideoSize videoSize = player.getVideoSize();
;
              videoHeight = videoSize.height;
              videoWidth = videoSize.width;
              if (glFrameExtractor != null) {
                player.setVideoSurface(glFrameExtractor.getSurface());
              }
              handleReady();
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

  private void handleReady() {
    updateCurrentPosition();
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

  public void setupGL() {
    if (Looper.myLooper() != Looper.getMainLooper()) {
      throw new RuntimeException("setupGL should be called on UI Thread");
    }
    EGLContext sharedContext = EGLUtils.getCurrentContextOrThrows();
    eglResourcesHolder = EGLResourcesHolder.createWithPBBufferSurface(sharedContext);
    eglResourcesHolder.makeCurrent();
    glFrameExtractor = new GLFrameExtractor();
    if (player != null) {
      player.setVideoSurface(glFrameExtractor.getSurface());
    }
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
   * Decode the next frame of the video
   *
   * @return whether the frame was decoded successfully
   */
  public VideoFrame decodeNextFrame() {
    if (Looper.myLooper() != Looper.getMainLooper()) {
      throw new RuntimeException("decodeNextFrame should be called on UI Thread");
    }
    if (eglResourcesHolder == null && glFrameExtractor != null) {
      return null;
    }
    eglResourcesHolder.makeCurrent();
    boolean downscale = outputWidth > 0 && outputHeight > 0;
    int width = downscale ? outputWidth : videoWidth;
    int height = downscale ? outputHeight : videoHeight;
    if (width > 0 && height > 0 && glFrameExtractor.decodeNextFrame(width, height)) {
      return new VideoFrame(
        glFrameExtractor.getOutputTexId(),
        videoWidth,
        videoHeight,
        0,
        glFrameExtractor.getLatestTimeStampNs()
      );
    }
    return null;
  }

  /**
   * Release the video player and its resources
   */
  public void release() {
    released = true;
    if (glFrameExtractor != null) {
      glFrameExtractor.release();
      glFrameExtractor = null;
    }
    if (eglResourcesHolder != null) {
      eglResourcesHolder.release();
      glFrameExtractor = null;
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
