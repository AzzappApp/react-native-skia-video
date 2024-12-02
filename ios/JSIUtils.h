#pragma once
#import <jsi/jsi.h>

namespace RNSkiaVideo {

using namespace facebook;


static jsi::Value NSErrorToJSI(jsi::Runtime& runtime, NSError* error) {
  auto jsError = jsi::Object(runtime);
  auto message = error == nil ? @"Unknown error" : [error description];
  jsError.setProperty(
      runtime, "message",
      jsi::String::createFromUtf8(runtime, [message UTF8String]));
  jsError.setProperty(runtime, "code",
                      error != nil ? jsi::Value((double)[error code])
                                   : jsi::Value::null());
  return jsError;
}
} // namespace RNSkiaVideo
