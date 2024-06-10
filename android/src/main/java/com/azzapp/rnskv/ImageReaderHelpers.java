package com.azzapp.rnskv;

import android.hardware.HardwareBuffer;
import android.media.ImageReader;
import android.os.Build;

public class ImageReaderHelpers {
  public static ImageReader createImageReader(int format, int width, int height) {
    ImageReader imageReader;
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      imageReader = ImageReader.newInstance(
        width,
        height,
        format,
        3,
        HardwareBuffer.USAGE_GPU_SAMPLED_IMAGE
      );
    } else {
      imageReader = ImageReader.newInstance(width, height, format, 3);
    }
    return imageReader;
  }
}
