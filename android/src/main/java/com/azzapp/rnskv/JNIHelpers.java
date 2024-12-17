package com.azzapp.rnskv;

/**
 * Helper class to get the Skia platform context.
 */
public class JNIHelpers {

  static public Object getCallInvoker() {
    return ReactNativeSkiaVideoModule.currentReactApplicationContext()
      .getCatalystInstance().getJSCallInvokerHolder();
  }
}
