#pragma once

#include <fbjni/fbjni.h>
#include <jni.h>
#include <jsi/jsi.h>

namespace RNSkiaVideo {

namespace JSIJNIConversion {

  using namespace facebook;
  jsi::Value convertJNIObjectToJSIValue(jsi::Runtime& runtime,
                                        const jni::alias_ref<jobject>& object);

} // namespace JSIJNIConversion

} // namespace RNSkiaVideo
