package com.azzapp.rnskv;

import android.os.Handler;
import android.os.HandlerThread;
import android.os.Message;
import android.os.Process;
import android.os.SystemClock;

import java.io.IOException;
import java.util.Map;

/**
 * A class that previews a video composition.
 */
public class VideoCompositionFramesExtractor {
  private static final String TAG = "VideoCompositionFramesExtractor";

  private final VideoComposition composition;

  private final VideoCompositionDecoder decoder;

  PlaybackThread playbackThread;

  private final NativeEventDispatcher eventDispatcher;

  /**
   * Create a new VideoCompositionFramesExtractor.
   *
   * @param composition the video composition to preview
   */
  public VideoCompositionFramesExtractor(VideoComposition composition, NativeEventDispatcher eventDispatcher) {
    this.eventDispatcher = eventDispatcher;
    this.composition = composition;
    decoder = new VideoCompositionDecoder(composition);
    playbackThread = new PlaybackThread();
    playbackThread.start();
  }

  /**
   * Start playing the composition.
   */
  public void play() {
    playbackThread.play();
  }

  /**
   * Pause the composition.
   */
  public void pause() {
    playbackThread.pause();
  }

  /**
   * Seek to given position
   */
  public void seekTo(long position) {
    playbackThread.seekTo(position);
  }

  /**
   * Release the composition player.
   */
  public void release() {
    playbackThread.release();
  }

  /**
   * Decode the next frame of each composition item according to the current position of the player.
   *
   * @return a map of item id to video frame
   */
  public Map<String, VideoFrame> decodeCompositionFrames() {
    return decoder.getUpdatedVideoFrames();
  }

  /**
   * @return the current position of the player in microseconds
   */
  public long getCurrentPosition() {
    return playbackThread.getCurrentPosition();
  }

  /**
   * @return whether the player is looping
   */
  public boolean getIsLooping() {
    return playbackThread.looping;
  }

  /**
   * Set whether the player should loop.
   */
  public void setIsLooping(boolean value) {
    playbackThread.looping = value;
    if (playbackThread.isEOS && value) {
      playbackThread.play();
    }
  }

  /**
   * @return whether the player is currently playing
   */
  public boolean getIsPlaying() {
    return playbackThread.isPlaying;
  }

  private class PlaybackThread extends HandlerThread implements Handler.Callback {
    private static final int PLAYBACK_PREPARE = 1;
    private static final int PLAYBACK_PLAY = 2;
    private static final int PLAYBACK_PAUSE = 3;
    private static final int PLAYBACK_LOOP = 4;
    private static final int PLAYBACK_SEEK = 5;
    private static final int PLAYBACK_RELEASE = 6;
    private boolean isPlaying = false;
    private boolean prepared;
    private boolean releasing;
    private boolean looping;

    private long startTime;
    private long pausePosition = 0;
    private boolean isEOS = false;
    private Handler handler;

    public PlaybackThread() {
      super(TAG + PlaybackThread.class.getSimpleName(), Process.THREAD_PRIORITY_VIDEO);
    }

    @Override
    public synchronized void start() {
      super.start();
      // Create the handler that will process the messages on the handler thread
      handler = new Handler(this.getLooper(), this);
      handler.sendEmptyMessage(PLAYBACK_PREPARE);
    }

    public void play() {
      handler.sendEmptyMessage(PLAYBACK_PLAY);
    }

    public void pause() {
      handler.sendEmptyMessage(PLAYBACK_PAUSE);
    }

    public void seekTo(long position) {
      handler.removeMessages(PLAYBACK_SEEK);
      handler.obtainMessage(PLAYBACK_SEEK, position).sendToTarget();
    }

    public long getCurrentPosition() {
      return isPlaying ? microTime() - startTime : pausePosition;
    }

    public void release() {
      if (!isAlive()) {
        return;
      }

      isPlaying = false;
      releasing = true;
      handler.sendEmptyMessage(PLAYBACK_RELEASE);
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

    private void prepareInternal() {
      if (prepared) {
        return;
      }
      decoder.prepare();
      decoder.start();
      prepared = true;
      eventDispatcher.dispatchEvent("ready", null);
      handler.sendEmptyMessage(PLAYBACK_LOOP);
    }

    private void playInternal() {
      if (!prepared || isPlaying) {
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
        return;
      }
      pausePosition = getCurrentPosition();
      isPlaying = false;
    }

    private void loopInternal() throws IOException, InterruptedException {
      long loopStartTime = SystemClock.elapsedRealtime();

      long currentPosition = getCurrentPosition();

      isEOS = currentPosition >= TimeHelpers.secToUs(composition.getDuration());
      if (isEOS) {
        eventDispatcher.dispatchEvent("complete", null);
        isPlaying = false;
        pausePosition = TimeHelpers.secToUs(composition.getDuration());
        currentPosition = pausePosition;
      }
      decoder.render(currentPosition);
      if (isEOS && looping) {
        playInternal();
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
      decoder.seekTo(position);
      if (isPlaying) {
        startTime = microTime() - position;
      } else {
        pausePosition = position;
      }
    }

    private void releaseInternal() {
      interrupt();
      quit();
      decoder.release();
    }
  }

  private static long microTime() {
    return System.nanoTime() / 1000;
  }
}
