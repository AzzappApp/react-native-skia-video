package com.azzapp.reactnativeskiavideo;

import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.Promise;

abstract class ReactNativeSkiaVideoSpec extends ReactContextBaseJavaModule {
  ReactNativeSkiaVideoSpec(ReactApplicationContext context) {
    super(context);
  }

  public abstract void multiply(double a, double b, Promise promise);
}
