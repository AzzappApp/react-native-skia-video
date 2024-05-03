package com.azzapp.rnskv;

import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;

abstract class ReactNativeSkiaVideoSpec extends ReactContextBaseJavaModule {
  ReactNativeSkiaVideoSpec(ReactApplicationContext context) {
    super(context);
  }

  public abstract boolean install();
}
