package com.azzapp.rnskv;

import android.content.Context;
import android.hardware.display.DisplayManager;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.Looper;
import android.os.Message;
import android.os.Process;
import android.os.SystemClock;
import android.util.Log;
import android.view.Choreographer;
import android.view.Display;

import androidx.annotation.Nullable;
import androidx.media3.common.util.UnstableApi;

import java.io.IOException;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * A class that previews a video composition.
 */
@UnstableApi
public class VideoCompositionFramesExtractor {
  private static final String TAG = "VideoCompositionFramesExtractor";

  private static final int PLAYBACK_PREPARE = 1;
  private static final int PLAYBACK_PLAY = 2;
  private static final int PLAYBACK_PAUSE = 3;
  private static final int PLAYBACK_LOOP = 4;
  private static final int PLAYBACK_SEEK = 5;
  private static final int PLAYBACK_RELEASE = 6;
  private static final int PLAYBACK_SET_VOLUME = 7;
  private static final int PLAYBACK_RENDER = 8;
  private static final int PLAYBACK_DECODERS_SEEKED = 9;

  /**
   * How long after the last display refresh the playback loop renders the frames itself (the app
   * in the background, a stalled UI thread): a decoder keeps its output buffers until they are.
   */
  private static final long REFRESH_RENDER_TIMEOUT_NS = 100_000_000;

  /**
   * The longest interval between two refreshes taken as the time to the next refresh, when the
   * display's refresh period is unknown (see frameCallback): a longer one is refreshes the UI thread
   * missed.
   */
  private static final long MAX_REFRESH_PERIOD_NS = 34_000_000;

  private final VideoComposition composition;

  private final VideoCompositionDecoder decoder;

  private AudioCompositionPlayer audioPlayer;

  private final PlaybackThread playbackThread;

  private final Handler handler;

  /**
   * Opens, closes and seeks the decoders (see VideoCompositionDecoder#updateDecoders): creating or
   * releasing a decoder takes tens of milliseconds, during which the playback thread keeps
   * rendering the frames of the other items. The decoders' callbacks run on the playback thread.
   */
  private final HandlerThread codecThread;

  private final Handler codecHandler;

  private final AtomicBoolean decoderUpdatePosted = new AtomicBoolean(false);

  private volatile long decoderUpdatePositionUs = 0;

  private final AtomicBoolean decoderSeekPosted = new AtomicBoolean(false);

  private volatile long decoderSeekPositionUs = 0;

  /**
   * The seeks of the decoders posted to the codec thread and not done yet, on the playback thread:
   * the frames are not rendered meanwhile, not to show the frames of before a seek.
   */
  private int pendingDecoderSeeks = 0;

  private final NativeEventDispatcher eventDispatcher;

  private boolean playWhenReady = false;

  // Master volume (0..1); read from any thread, applied on the playback one.
  private volatile float volume = 1f;

  private boolean prepared;
  // Also read on the UI thread, by frameCallback.
  private volatile boolean releasing;
  // Also read on the codec thread.
  private volatile boolean looping;


  private long pendingSeek = 0;
  private volatile boolean isPlaying = false;

  private volatile long startTime = 0;
  private volatile long pausePosition = 0;

  /**
   * When the frames were last rendered for a display refresh, on the playback thread.
   */
  private long lastRefreshRenderNs = 0;

  /**
   * The time of the previous display refresh, on the UI thread.
   */
  private long lastFrameTimeNs = 0;

  private final Handler mainHandler = new Handler(Looper.getMainLooper());

  /**
   * The display's refresh period, 0 when unknown, on the UI thread: followed as the display changes
   * its refresh rate (see watchDisplay).
   */
  private long refreshPeriodNs = 0;

  @Nullable
  private DisplayManager displayManager;

  private final DisplayManager.DisplayListener displayListener =
    new DisplayManager.DisplayListener() {
      @Override
      public void onDisplayAdded(int displayId) {
      }

      @Override
      public void onDisplayRemoved(int displayId) {
      }

      @Override
      public void onDisplayChanged(int displayId) {
        if (displayId == Display.DEFAULT_DISPLAY) {
          updateRefreshPeriod();
        }
      }
    };

  /**
   * Renders the frames at each display refresh, rather than on the playback loop's own clock: the
   * frames due at the next refresh are rendered on each refresh, at the same phase of it, and the
   * decoders' readers report them on the UI thread's looper, after this frame. The frame callback
   * of the composition player acquires them on the next refresh, every frame. Rendered every 10 ms,
   * as the frames came due, a frame landed on either side of a refresh: about one frame in six
   * stayed 50 ms on screen and another 17 ms, for a 30 fps video on a 60 Hz display.
   *
   * The next refresh is taken the display's refresh period away rather than the interval since the
   * previous refresh: after a refresh the UI thread missed, that interval is two periods, and the
   * frames due a refresh later would be rendered, one of them shown a refresh early.
   */
  private final Choreographer.FrameCallback frameCallback = new Choreographer.FrameCallback() {
    @Override
    public void doFrame(long frameTimeNanos) {
      if (releasing) {
        return;
      }
      long periodNs = refreshPeriodNs;
      if (periodNs == 0) {
        periodNs = lastFrameTimeNs > 0 ? frameTimeNanos - lastFrameTimeNs : 0;
      }
      lastFrameTimeNs = frameTimeNanos;
      long leadNs = Math.max(0, Math.min(periodNs, MAX_REFRESH_PERIOD_NS));
      // The display's clock and the playback's are both System.nanoTime().
      long positionUs = getPositionAt((frameTimeNanos + leadNs) / 1000);
      handler.obtainMessage(PLAYBACK_RENDER, positionUs).sendToTarget();
      Choreographer.getInstance().postFrameCallback(this);
    }
  };
  private boolean isEOS = false;
  private boolean completeDispatched = false;

  /**
   * Create a new VideoCompositionFramesExtractor.
   *
   * @param composition the video composition to preview
   */
  public VideoCompositionFramesExtractor(VideoComposition composition, NativeEventDispatcher eventDispatcher) {
    this.eventDispatcher = eventDispatcher;
    this.composition = composition;
    decoder = new VideoCompositionDecoder(composition, false);
    playbackThread = new PlaybackThread();
    playbackThread.start();
    handler = new Handler(playbackThread.getLooper(), playbackThread);
    codecThread = new HandlerThread("ReactNativeSkiaVideo-Codecs");
    codecThread.start();
    codecHandler = new Handler(codecThread.getLooper());
    decoder.setCallbackHandler(handler);
  }

  public void prepare() {
    if (prepared) {
      return;
    }
    decoder.prepare();
    handler.sendEmptyMessage(PLAYBACK_PREPARE);
    mainHandler.post(() -> {
      if (releasing) {
        return;
      }
      watchDisplay();
      Choreographer.getInstance().postFrameCallback(frameCallback);
    });
  }

  /**
   * Follows the refresh rate of the display, on the UI thread: an adaptive display changes it with
   * what it shows (e.g. 120 Hz while scrolling, 60 Hz on a video). Without a React context, the
   * refresh period is taken from the interval between two refreshes.
   */
  private void watchDisplay() {
    Context context = ReactNativeSkiaVideoModule.currentReactApplicationContext();
    displayManager = context != null ? context.getSystemService(DisplayManager.class) : null;
    if (displayManager == null) {
      return;
    }
    // On the looper of the UI thread.
    displayManager.registerDisplayListener(displayListener, null);
    updateRefreshPeriod();
  }

  private void unwatchDisplay() {
    if (displayManager != null) {
      displayManager.unregisterDisplayListener(displayListener);
      displayManager = null;
    }
  }

  private void updateRefreshPeriod() {
    Display display =
      displayManager != null ? displayManager.getDisplay(Display.DEFAULT_DISPLAY) : null;
    float refreshRate = display != null ? display.getRefreshRate() : 0;
    refreshPeriodNs = refreshRate > 0 ? (long) (1_000_000_000L / refreshRate) : 0;
  }

  /**
   * Start playing the composition.
   */
  public void play() {
    handler.sendEmptyMessage(PLAYBACK_PLAY);
  }

  /**
   * Pause the composition.
   */
  public void pause() {
    handler.sendEmptyMessage(PLAYBACK_PAUSE);
  }

  /**
   * Seek to given position
   */
  public void seekTo(long position) {
    handler.removeMessages(PLAYBACK_SEEK);
    handler.obtainMessage(PLAYBACK_SEEK, position).sendToTarget();
  }

  /**
   * Decode the next frame of each composition item according to the current position of the player.
   *
   * @return a map of item id to video frame
   */
  public Map<String, VideoFrame> decodeCompositionFrames() {
    return decoder.updateVideosFrames(getCurrentPosition());
  }

  /**
   * @return the current position of the player in microseconds
   */
  public long getCurrentPosition() {
    return getPositionAt(microTime());
  }

  /**
   * @param timeUs a time of {@link #microTime}
   * @return the position of the player at that time in microseconds
   */
  private long getPositionAt(long timeUs) {
    return isPlaying ? timeUs - startTime : pausePosition;
  }

  /**
   * @return the master volume (0..1)
   */
  public float getVolume() {
    return volume;
  }

  /**
   * Sets the master volume, on top of the items' own volumes. Applied on the
   * playback thread: ExoPlayer instances live there.
   */
  public void setVolume(float value) {
    volume = Math.max(0f, Math.min(1f, value));
    handler.removeMessages(PLAYBACK_SET_VOLUME);
    handler.sendEmptyMessage(PLAYBACK_SET_VOLUME);
  }

  /**
   * @return whether the player is looping
   */
  public boolean getIsLooping() {
    return looping;
  }

  /**
   * Set whether the player should loop.
   */
  public void setIsLooping(boolean value) {
    looping = value;
    if (prepared && isEOS && value) {
      play();
    }
  }

  /**
   * @return whether the player is currently playing
   */
  public boolean getIsPlaying() {
    return isPlaying;
  }

  public void release() {
    // Also stops frameCallback.
    releasing = true;
    mainHandler.post(this::unwatchDisplay);
    if (!playbackThread.isAlive()) {
      codecThread.quitSafely();
      decoder.release();
      return;
    }
    isPlaying = false;
    handler.sendEmptyMessage(PLAYBACK_RELEASE);
  }

  private void prepareInternal() throws IOException {
    decoder.start();
    if (composition.hasAudio()) {
      audioPlayer = new AudioCompositionPlayer(composition);
      audioPlayer.setOnErrorListener(
        message -> eventDispatcher.dispatchEvent("error", message));
      // a volume set before prepare applies from the first sample
      audioPlayer.setVolume(volume);
      audioPlayer.prepare();
    }
    prepared = true;
    eventDispatcher.dispatchEvent("ready", null);
    handler.sendEmptyMessage(PLAYBACK_LOOP);
    if (pendingSeek != 0) {
      seekInternal(pendingSeek);
    }
    if (playWhenReady) {
      playInternal();
    }
  }

  private void playInternal() throws IOException {
    if (!prepared) {
      playWhenReady = true;
      return;
    }
    // Already playing: nothing to do. Recomputing startTime from a zero
    // pausePosition would restart the clock at 0: a seek followed by play
    // (the usual "play from here") landed at the beginning instead.
    if (isPlaying) {
      return;
    }
    if (isEOS) {
      isEOS = false;
      pausePosition = 0;
      seekInternal(0);
    }
    startTime = microTime() - pausePosition;
    isPlaying = true;
    pausePosition = 0;
  }

  private void pauseInternal() {
    if (!isPlaying) {
      playWhenReady = false;
      return;
    }
    pausePosition = getCurrentPosition();
    isPlaying = false;
    if (audioPlayer != null) {
      audioPlayer.pause();
    }
  }

  private void loopInternal() throws IOException, InterruptedException {
    long loopStartTime = SystemClock.elapsedRealtime();

    long currentPosition = getCurrentPosition();

    isEOS = currentPosition >= TimeHelpers.secToUs(composition.getDuration());
    if (isEOS) {
      if (!completeDispatched) {
        completeDispatched = true;
        eventDispatcher.dispatchEvent("complete", null);
      }
      isPlaying = false;
      pausePosition = TimeHelpers.secToUs(composition.getDuration());
      currentPosition = pausePosition;
    } else {
      completeDispatched = false;
    }
    updateDecoders(currentPosition);
    // The frames are rendered at each display refresh (see frameCallback), here only when the
    // display stopped refreshing.
    if (pendingDecoderSeeks == 0
      && System.nanoTime() - lastRefreshRenderNs > REFRESH_RENDER_TIMEOUT_NS) {
      decoder.render(currentPosition, looping);
    }
    if (isEOS && looping) {
      playInternal();
    }
    if (audioPlayer != null) {
      audioPlayer.update(getCurrentPosition(), isPlaying);
    }
    long delay = 10;
    long duration = (SystemClock.elapsedRealtime() - loopStartTime);
    delay = delay - duration;
    if (delay > 0) {
      handler.sendEmptyMessageDelayed(PLAYBACK_LOOP, delay);
    } else {
      handler.sendEmptyMessage(PLAYBACK_LOOP);
    }
  }

  private void seekInternal(long position) {
    if (!prepared) {
      pendingSeek = position;
      return;
    }
    seekDecoders(position);
    if (audioPlayer != null) {
      audioPlayer.seekTo(position);
    }
    if (isPlaying) {
      startTime = microTime() - position;
    } else {
      pausePosition = position;
    }
  }

  private void releaseInternal() {
    if (audioPlayer != null) {
      try {
        audioPlayer.release();
      } catch (Exception e) {
        Log.w(TAG, "Could not release the audio players", e);
      }
      audioPlayer = null;
    }
    // The codec thread is done with the decoders before they are released.
    codecThread.quitSafely();
    try {
      codecThread.join(1000);
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
    }
    playbackThread.interrupt();
    playbackThread.quit();
    decoder.release();
  }

  private interface DecoderTask {
    void run() throws IOException;
  }

  /**
   * Runs a task on the codec thread. Its failure is reported as an error and releases the player,
   * as a failure on the playback thread does.
   */
  private void runOnCodecThread(DecoderTask task) {
    codecHandler.post(() -> {
      if (releasing) {
        return;
      }
      try {
        task.run();
      } catch (Exception e) {
        if (!releasing) {
          eventDispatcher.dispatchEvent("error", e.getMessage());
          release();
        }
      }
    });
  }

  /**
   * Has the codec thread seek the decoders to the given position: once for the latest position
   * requested while it was busy. A slider seeks on each move, and a seek takes the codec thread
   * tens of milliseconds: each one done in turn, the preview froze during the move, then went
   * through every position of it.
   */
  private void seekDecoders(long positionUs) {
    decoderSeekPositionUs = positionUs;
    if (decoderSeekPosted.compareAndSet(false, true)) {
      pendingDecoderSeeks++;
      runOnCodecThread(() -> {
        decoderSeekPosted.set(false);
        try {
          decoder.seekTo(decoderSeekPositionUs, looping);
        } finally {
          handler.sendEmptyMessage(PLAYBACK_DECODERS_SEEKED);
        }
      });
    }
  }

  /**
   * Has the codec thread open and close the decoders for the given position: once for the latest
   * position requested while it was busy.
   */
  private void updateDecoders(long positionUs) {
    decoderUpdatePositionUs = positionUs;
    if (decoderUpdatePosted.compareAndSet(false, true)) {
      runOnCodecThread(() -> {
        decoderUpdatePosted.set(false);
        decoder.updateDecoders(decoderUpdatePositionUs, looping);
      });
    }
  }

  private class PlaybackThread extends HandlerThread implements Handler.Callback {
    public PlaybackThread() {
      super(TAG + PlaybackThread.class.getSimpleName(), Process.THREAD_PRIORITY_VIDEO);
    }

    @Override
    public boolean handleMessage(Message msg) {
      try {
        if (releasing) {
          // When the releasing flag is set, just release without processing any more messages
          releaseInternal();
          return true;
        }

        switch (msg.what) {
          case PLAYBACK_PREPARE -> {
            prepareInternal();
            return true;
          }
          case PLAYBACK_PLAY -> {
            playInternal();
            return true;
          }
          case PLAYBACK_PAUSE -> {
            pauseInternal();
            return true;
          }
          case PLAYBACK_LOOP -> {
            loopInternal();
            return true;
          }
          case PLAYBACK_SEEK -> {
            seekInternal((Long) msg.obj);
            return true;
          }
          case PLAYBACK_RELEASE -> {
            releaseInternal();
            return true;
          }
          case PLAYBACK_RENDER -> {
            if (prepared && pendingDecoderSeeks == 0) {
              decoder.render((Long) msg.obj, looping);
            }
            lastRefreshRenderNs = System.nanoTime();
            return true;
          }
          case PLAYBACK_DECODERS_SEEKED -> {
            pendingDecoderSeeks--;
            return true;
          }
          case PLAYBACK_SET_VOLUME -> {
            if (audioPlayer != null) {
              audioPlayer.setVolume(volume);
            }
            return true;
          }
          default -> {
            return false;
          }
        }
      } catch (Exception error) {
        eventDispatcher.dispatchEvent("error", error.getMessage());
      }

      // Release after an exception
      releaseInternal();
      return true;
    }
  }

  private static long microTime() {
    return System.nanoTime() / 1000;
  }
}
