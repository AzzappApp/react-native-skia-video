package com.azzapp.rnskv;

import android.graphics.ImageFormat;
import android.hardware.HardwareBuffer;
import android.media.Image;
import android.media.ImageReader;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.Looper;
import android.os.Message;
import android.os.Process;
import android.os.SystemClock;

import androidx.annotation.NonNull;

import java.io.IOException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * A class that previews a video composition.
 */
public class VideoCompositionFramesExtractor {
  private static final String TAG = "VideoCompositionFramesExtractor";

  private final VideoComposition composition;

  private final HashMap<VideoComposition.Item, VideoCompositionItemDecoder> decoders;

  private HashMap<VideoComposition.Item, ImageReader> imageReaders;

  private final HashMap<String, VideoFrame> videoFrames = new HashMap<>();

  PlaybackThread playbackThread;

  private final NativeEventDispatcher eventDispatcher;

  /**
   * Create a new VideoCompositionFramesExtractor.
   * @param composition the video composition to preview
   */
  public VideoCompositionFramesExtractor(VideoComposition composition, NativeEventDispatcher eventDispatcher) {
    this.eventDispatcher = eventDispatcher;
    this.composition = composition;
    decoders = new HashMap<>();
    composition.getItems().forEach(item -> {
      VideoCompositionItemDecoder decoder = new VideoCompositionItemDecoder(item);
      decoders.put(item, decoder);
    });
    playbackThread = new PlaybackThread(decoders, this::releaseImageReaders);
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
   * Seek to givent position
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
   * @return an array of the ids of the items that have a new frame
   */
  public Map<String, VideoFrame> decodeCompositionFrames() {
    if (Looper.myLooper() != Looper.getMainLooper()) {
      throw new RuntimeException("decodeNextFrame should be called on UI Thread");
    }
    if (imageReaders == null) {
      return videoFrames;
    }
    for (Map.Entry<VideoComposition.Item, ImageReader> entry: imageReaders.entrySet()) {
      VideoComposition.Item item = entry.getKey();
      ImageReader imageReader = entry.getValue();
      VideoCompositionItemDecoder decoder = decoders.get(item);
      Image image = imageReader.acquireLatestImage();
      if (image != null && decoder != null) {
        HardwareBuffer hardwareBuffer = image.getHardwareBuffer();
        image.close();
        if (hardwareBuffer != null) {
          String id = item.getId();
          VideoFrame currentFrame = videoFrames.get(id);
          if (currentFrame != null) {
            currentFrame.getBuffer().close();
          }
          videoFrames.put(id, new VideoFrame(
            hardwareBuffer,
            decoder.getVideoWidth(),
            decoder.getVideoHeight(),
            decoder.getRotation()
          ));
        }
      }
    }
    return videoFrames;
  }

  /**
   * @return the current position of the player in microseconds
   */
  public long getCurrentPosition() {
    return playbackThread.currentPosition;
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
    return !playbackThread.paused;
  }

  private void releaseImageReaders() {
    for (ImageReader imageReader: imageReaders.values()) {
      imageReader.close();
    }
    imageReaders.clear();
  }

  private class PlaybackThread extends HandlerThread implements Handler.Callback {
    private static final int PLAYBACK_PLAY = 1;
    private static final int PLAYBACK_PAUSE = 2;
    private static final int PLAYBACK_LOOP = 3;
    private static final int PLAYBACK_SEEK = 4;
    private static final int PLAYBACK_RELEASE = 5;
    private boolean paused = true;
    private boolean prepared;
    private boolean releasing;
    private boolean looping;
    private final Map<VideoComposition.Item, VideoCompositionItemDecoder> itemDecoders;

    private long startTime;
    private long currentPosition = 0;
    private boolean isEOS = false;
    private Handler handler;

    private final OnPlaybackThreadRelease onPlaybackThreadRelease;

    public PlaybackThread(Map<VideoComposition.Item, VideoCompositionItemDecoder> itemDecoders,
                          OnPlaybackThreadRelease onPlaybackThreadRelease) {
      super(TAG + PlaybackThread.class.getSimpleName(), Process.THREAD_PRIORITY_VIDEO);
      this.itemDecoders = itemDecoders;
      this.onPlaybackThreadRelease = onPlaybackThreadRelease;
    }

    private final Map<
      VideoComposition.Item,
      List<VideoCompositionItemDecoder.Frame>
    > collectedFrames = new HashMap();

    @Override
    public synchronized void start() {
      super.start();
      // Create the handler that will process the messages on the handler thread
      handler = new Handler(this.getLooper(), this);
    }

    public void play() {
      paused = false;
      handler.sendEmptyMessage(PLAYBACK_PLAY);
    }

    public void pause() {
      paused = true;
      handler.sendEmptyMessage(PLAYBACK_PAUSE);
    }

    public void seekTo(long position) {
      handler.removeMessages(PLAYBACK_SEEK);
      handler.obtainMessage(PLAYBACK_SEEK, position).sendToTarget();
    }

    private void release() {
      if(!isAlive()) {
        return;
      }

      paused = true;
      releasing = true;
      handler.sendEmptyMessage(PLAYBACK_RELEASE);
    }


    @Override
    public boolean handleMessage(@NonNull Message msg) {
      try {
        if(releasing) {
          // When the releasing flag is set, just release without processing any more messages
          releaseInternal();
          return true;
        }

        switch (msg.what) {
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
      imageReaders = new HashMap<>();
      decoders.values().forEach(decoder -> {
        try {
          decoder.prepare();
          ImageReader imageReader;
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            imageReader = ImageReader.newInstance(
              decoder.getVideoWidth(),
              decoder.getVideoHeight(),
              ImageFormat.PRIVATE, 2,
              HardwareBuffer.USAGE_GPU_SAMPLED_IMAGE
            );
          } else {
            imageReader = ImageReader.newInstance(
              decoder.getVideoWidth(), decoder.getVideoHeight(), ImageFormat.PRIVATE, 2);
          }
          imageReaders.put(decoder.getItem(), imageReader);
          decoder.setSurface(imageReader.getSurface());
        } catch (IOException e) {
          throw new RuntimeException(e);
        }
      });

      prepared = true;
      eventDispatcher.dispatchEvent("ready", null);
    }

    private void playInternal() throws IOException, InterruptedException {
      if (!prepared) {
        prepareInternal();
      }
      if(isEOS) {
        isEOS = false;
        seekInternal(0);
      }
      long minPos = Long.MAX_VALUE;
      for (VideoCompositionItemDecoder decoder: decoders.values()) {
        if (decoder.getOutputPresentationTimeTimeUS() < minPos) {
          minPos = decoder.getInputSamplePresentationTimeUS();
        }
      }

      startTime = microTime() - minPos;
      loopInternal();
    }

    private void pauseInternal() {
      handler.removeMessages(PLAYBACK_LOOP);
    }

    /* Deltat value that we use keep input buffer with an advance of time to be sure that decoders
     * Input buffer contains enough data
     */
    private static final long INPUT_DELTA = 500000L;

    private void loopInternal() throws IOException, InterruptedException {
      long loopStartTime = SystemClock.elapsedRealtime();

      currentPosition = microTime() - startTime;

      isEOS = currentPosition >= TimeHelpers.secToUs(composition.getDuration());

      if (isEOS) {
        eventDispatcher.dispatchEvent("complete", null);
        if(looping) {
          playInternal();
        } else {
          paused = true;
          pauseInternal();
        }
      } else {
        for (VideoCompositionItemDecoder itemDecoder : decoders.values()) {
          VideoComposition.Item item = itemDecoder.getItem();
          long compositionStartTime = TimeHelpers.secToUs(item.getCompositionStartTime());
          long startTime = TimeHelpers.secToUs(item.getStartTime());
          long duration = TimeHelpers.secToUs(item.getDuration());
          if (
            compositionStartTime <= currentPosition
              && currentPosition <= compositionStartTime + duration + INPUT_DELTA) {
            while (true) {
              if (itemDecoder.getInputSamplePresentationTimeUS() >=
                  currentPosition + startTime + INPUT_DELTA - compositionStartTime) {
                break;
              }
              boolean queued = itemDecoder.queueSampleToCodec();
              if (!queued) {
                break;
              }
            }

            while (true) {
              VideoCompositionItemDecoder.Frame frame = itemDecoder.dequeueOutputBuffer();
              if (frame == null) {
                break;
              }
              List<VideoCompositionItemDecoder.Frame> frameList;
              if (!collectedFrames.containsKey(item)) {
                frameList = new ArrayList<>();
                collectedFrames.put(item, frameList);
              } else {
                frameList = collectedFrames.get(item);
              }
              frameList.add(frame);
            }
          }
        }
      }

      for (
        Map.Entry<VideoComposition.Item, List<VideoCompositionItemDecoder.Frame>> entry:
          collectedFrames.entrySet()) {
        VideoComposition.Item item = entry.getKey();
        List<VideoCompositionItemDecoder.Frame> itemFrames = entry.getValue();
        ArrayList<VideoCompositionItemDecoder.Frame> renderedFrames = new ArrayList<>();

        long compositionStartTime = TimeHelpers.secToUs(item.getCompositionStartTime());
        long startTime = TimeHelpers.secToUs(item.getStartTime());
        long duration = TimeHelpers.secToUs(item.getDuration());
        long itemPosition = Math.min(
          startTime + currentPosition - compositionStartTime,
          startTime + duration
        );

        for (VideoCompositionItemDecoder.Frame frame: itemFrames) {
          if (frame.getPresentationTimeUs() <= itemPosition) {
            renderedFrames.add(frame);
          }
        }
        itemFrames.removeAll(renderedFrames);
        renderedFrames.forEach(VideoCompositionItemDecoder.Frame::render);
      }

      if(!paused) {
        long delay = 10;
        long duration = (SystemClock.elapsedRealtime() - loopStartTime);
        delay = delay - duration;
        if(delay > 0) {
          handler.sendEmptyMessageDelayed(PLAYBACK_LOOP, delay);
        } else {
          handler.sendEmptyMessage(PLAYBACK_LOOP);
        }
      }
    }

    private void seekInternal(long position) {
      startTime = microTime() - position;
      currentPosition = position;
      collectedFrames.values().forEach(frames ->
        frames.forEach(VideoCompositionItemDecoder.Frame::release));
      collectedFrames.clear();
      decoders.values().forEach(itemDecoder -> itemDecoder.seekTo(position));
    }

    private void releaseInternal() {
      interrupt();
      quit();
      collectedFrames.values().forEach(frames ->
        frames.forEach(VideoCompositionItemDecoder.Frame::release));
      collectedFrames.clear();
      itemDecoders.values().forEach(VideoCompositionItemDecoder::release);
      onPlaybackThreadRelease.onReleased();
    }
  }


  private interface OnPlaybackThreadRelease {
    void onReleased();
  }

  private static long microTime() {
    return System.nanoTime() / 1000;
  }
}


