package com.azzapp.reactnativeskiavideo;

import androidx.annotation.NonNull;

import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactMethod;

public class ReactNativeSkiaVideoModule extends ReactNativeSkiaVideoSpec {
  public static final String NAME = "ReactNativeSkiaVideo";

  ReactNativeSkiaVideoModule(ReactApplicationContext context) {
    super(context);
  }

  @Override
  @NonNull
  public String getName() {
    return NAME;
  }

  static {
    System.loadLibrary("azzapp-react-native-skia-video");
  }

  public static native double nativeMultiply(double a, double b);

  // Example method
  // See https://reactnative.dev/docs/native-modules-android
  @ReactMethod
  public void multiply(double a, double b, Promise promise) {
    promise.resolve(nativeMultiply(a, b));
  }
}
