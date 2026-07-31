package com.azzapp.rnskv;

import androidx.annotation.Nullable;

import com.facebook.react.bridge.NativeModule;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.module.model.ReactModuleInfo;
import com.facebook.react.module.model.ReactModuleInfoProvider;
import com.facebook.react.BaseReactPackage;

import java.util.HashMap;
import java.util.Map;

public class ReactNativeSkiaVideoPackage extends BaseReactPackage {

  @Nullable
  @Override
  public NativeModule getModule(String name, ReactApplicationContext reactContext) {
    if (name.equals(ReactNativeSkiaVideoModule.NAME)) {
      return new ReactNativeSkiaVideoModule(reactContext);
    } else {
      return null;
    }
  }

  @Override
  public ReactModuleInfoProvider getReactModuleInfoProvider() {
    return () -> {
      final Map<String, ReactModuleInfo> moduleInfos = new HashMap<>();
      moduleInfos.put(
        ReactNativeSkiaVideoModule.NAME,
        new ReactModuleInfo(
          ReactNativeSkiaVideoModule.NAME,
          ReactNativeSkiaVideoModule.NAME,
          false, // canOverrideExistingModule
          false, // needsEagerInit
          false, // isCxxModule
          true // isTurboModule
        ));
      return moduleInfos;
    };
  }
}
