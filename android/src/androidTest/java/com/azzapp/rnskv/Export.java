package com.azzapp.rnskv;

import static org.junit.Assert.fail;

import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

import javax.microedition.khronos.egl.EGL10;

/**
 * The export's frame source, VideoCompositionFramesExtractorSync, started from
 * a context current on the test thread as the export worklet's is. Frames can
 * be read back and encoded from that thread.
 */
final class Export implements AutoCloseable {

  final VideoComposition composition;

  final VideoCompositionFramesExtractorSync extractor;

  final EGLResourcesHolder gl;

  private final ExecutorService executor = Executors.newSingleThreadExecutor();

  Export(VideoComposition composition) throws Exception {
    this.composition = composition;
    gl = EGLResourcesHolder.createWithPBBufferSurface(EGL10.EGL_NO_CONTEXT);
    gl.makeCurrent();
    extractor = new VideoCompositionFramesExtractorSync(composition);
    try {
      extractor.start();
    } catch (Exception e) {
      extractor.release();
      gl.release();
      throw e;
    }
  }

  VideoCompositionDecoder decoder() {
    return (VideoCompositionDecoder) Compositions.get(extractor, "decoder");
  }

  Map<String, VideoFrame> frames(double time) throws Exception {
    Future<Map<String, VideoFrame>> frames =
      executor.submit(() -> new HashMap<>(extractor.decodeCompositionFrames(time)));
    try {
      return frames.get(15, TimeUnit.SECONDS);
    } catch (TimeoutException e) {
      frames.cancel(true);
      fail("No frames for " + time + "s after 15 s: the export would hang");
      return null;
    }
  }

  @Override
  public void close() {
    extractor.release();
    executor.shutdownNow();
    gl.release();
  }
}
