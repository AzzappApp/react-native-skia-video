#pragma once
#import <Foundation/Foundation.h>
#import <jsi/jsi.h>
#import <stdexcept>
#import <string>

namespace RNSkiaVideo {

using namespace facebook;

// Describes an NSError for JS: its message, domain and code, and the
// underlying error (AVFoundation reports the actual cause there).
static std::string describeNSError(NSError* error) {
  NSMutableString* description = [NSMutableString
      stringWithFormat:@"%@ (%@ %ld)", error.localizedDescription, error.domain,
                       (long)error.code];
  if (error.localizedFailureReason) {
    [description appendFormat:@": %@", error.localizedFailureReason];
  }
  NSError* underlyingError = error.userInfo[NSUnderlyingErrorKey];
  if (underlyingError) {
    [description appendFormat:@" — underlying error: %@ (%@ %ld)",
                              underlyingError.localizedDescription,
                              underlyingError.domain,
                              (long)underlyingError.code];
  }
  return std::string([description UTF8String]);
}

// The worklet runtime threads that drive video exports never drain their
// autorelease pool, so every autoreleased object created by a host function
// (Metal command buffers, CoreMedia wrappers, AVFoundation internals…) would
// accumulate for the lifetime of the app. JSI entry points doing ObjC work
// should run their body through this helper. NSErrors are re-thrown as
// std::runtime_error, which JSI turns into a JS error with their message.
template <typename F> static jsi::Value runPooled(F&& body) {
  std::string pendingError;
  bool failed = false;
  @autoreleasepool {
    try {
      body();
    } catch (NSError* error) {
      failed = true;
      pendingError = describeNSError(error);
    }
  }
  if (failed) {
    throw std::runtime_error(pendingError);
  }
  return jsi::Value::undefined();
}

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
