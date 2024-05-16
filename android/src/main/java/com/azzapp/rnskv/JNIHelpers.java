package com.azzapp.rnskv;

import com.shopify.reactnative.skia.RNSkiaModule;

/**
 * Helper class to get the Skia platform context.
 */
public class JNIHelpers {

  /**
   * Get the Skia platform context. used from the native side.
   *
   * @return the Skia platform context
   */
  static public Object getSkiaPlatformContext() {
    return ReactNativeSkiaVideoModule.currentReactApplicationContext()
      .getNativeModule(RNSkiaModule.class)
      .getSkiaManager();
  }

  static public Object getCallInvoker() {
    return ReactNativeSkiaVideoModule.currentReactApplicationContext()
      .getCatalystInstance().getJSCallInvokerHolder();
  }
}
