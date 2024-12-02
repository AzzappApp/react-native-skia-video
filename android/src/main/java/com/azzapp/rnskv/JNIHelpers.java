package com.azzapp.rnskv;

import com.shopify.reactnative.skia.RNSkiaModule;

/**
 * Helper class to get the Skia platform context.
 */
public class JNIHelpers {

  static public Object getCallInvoker() {
    return ReactNativeSkiaVideoModule.currentReactApplicationContext()
      .getCatalystInstance().getJSCallInvokerHolder();
  }
}
