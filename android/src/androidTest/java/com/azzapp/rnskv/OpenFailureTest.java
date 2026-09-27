package com.azzapp.rnskv;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import android.media.MediaCodecInfo.CodecProfileLevel;
import android.media.MediaCodecList;
import android.media.MediaFormat;
import android.os.SystemClock;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.junit.Test;
import org.junit.runner.RunWith;

import java.io.File;
import java.io.FileOutputStream;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

import javax.microedition.khronos.egl.EGL10;

/**
 * Files a device cannot decode as they say: Dolby Vision without a Dolby
 * Vision decoder, and a file that is no video at all.
 */
@RunWith(AndroidJUnit4.class)
public class OpenFailureTest {

  private static String playableMime(MediaFormat format) throws Exception {
    Method method = VideoCompositionItemDecoder.class.getDeclaredMethod(
      "playableMime", MediaFormat.class, String.class);
    method.setAccessible(true);
    return (String) method.invoke(null, format, format.getString(MediaFormat.KEY_MIME));
  }

  private static MediaFormat dolbyVision(int profile) {
    MediaFormat format =
      MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_DOLBY_VISION, 1920, 1080);
    format.setInteger(MediaFormat.KEY_PROFILE, profile);
    format.setInteger(MediaFormat.KEY_LEVEL, CodecProfileLevel.DolbyVisionLevelFhd30);
    return format;
  }

  private static boolean hasDolbyVisionDecoder(MediaFormat format) {
    return new MediaCodecList(MediaCodecList.REGULAR_CODECS).findDecoderForFormat(format) != null;
  }

  // An iPhone HDR clip: profile 8.4 over HEVC.
  @Test
  public void dolbyVisionOverHevcIsDecodedAsHevcWithoutADolbyVisionDecoder() throws Exception {
    MediaFormat format = dolbyVision(CodecProfileLevel.DolbyVisionProfileDvheSt);
    if (hasDolbyVisionDecoder(format)) {
      assertEquals(MediaFormat.MIMETYPE_VIDEO_DOLBY_VISION, playableMime(format));
      return;
    }
    assertEquals(MediaFormat.MIMETYPE_VIDEO_HEVC, playableMime(format));
    assertEquals(MediaFormat.MIMETYPE_VIDEO_HEVC, format.getString(MediaFormat.KEY_MIME));
    assertTrue("the Dolby Vision profile is left for the HEVC decoder",
      !format.containsKey(MediaFormat.KEY_PROFILE));
  }

  @Test
  public void dolbyVisionOverAvcIsDecodedAsAvcWithoutADolbyVisionDecoder() throws Exception {
    MediaFormat format = dolbyVision(CodecProfileLevel.DolbyVisionProfileDvavSe);
    if (hasDolbyVisionDecoder(format)) {
      return;
    }
    assertEquals(MediaFormat.MIMETYPE_VIDEO_AVC, playableMime(format));
  }

  @Test
  public void otherCodecsAreLeftAlone() throws Exception {
    MediaFormat format = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, 320, 240);
    assertEquals(MediaFormat.MIMETYPE_VIDEO_AVC, playableMime(format));
  }

  /**
   * The preview's prepare() threw into the UI thread's worklet, which killed
   * the app: a file it cannot open is now an error event.
   */
  @Test
  public void aFileThePreviewCannotOpenIsAnErrorEvent() throws Exception {
    File cache = InstrumentationRegistry.getInstrumentation().getTargetContext().getCacheDir();
    File notAVideo = new File(cache, "not-a-video.mp4");
    try (FileOutputStream out = new FileOutputStream(notAVideo)) {
      out.write("not a video".getBytes());
    }
    File video = TestVideo.write(new File(cache, "open-failure.mp4"), 2);
    VideoComposition composition = Compositions.composition(video, false,
      new Compositions.Clip("good", 0, 0, 1));
    composition.getItems().add(new VideoComposition.Item(
      "bad", notAVideo.getPath(), 1, 0, 1));
    EGLResourcesHolder gl = EGLResourcesHolder.createWithPBBufferSurface(EGL10.EGL_NO_CONTEXT);
    gl.makeCurrent();
    List<String> events = Collections.synchronizedList(new ArrayList<>());
    VideoCompositionFramesExtractor extractor = new VideoCompositionFramesExtractor(
      composition, new NativeEventDispatcher(0) {
        @Override
        public void dispatchEvent(String eventName, Object data) {
          events.add(eventName + ":" + data);
        }
      });
    try {
      extractor.prepare();
      long deadline = SystemClock.uptimeMillis() + 2000;
      while (events.isEmpty() && SystemClock.uptimeMillis() < deadline) {
        SystemClock.sleep(10);
      }
      assertTrue("events: " + events, events.size() == 1 && events.get(0).startsWith("error:"));
    } finally {
      extractor.release();
      gl.release();
    }
  }
}
