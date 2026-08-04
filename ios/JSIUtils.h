#pragma once
#import <Foundation/Foundation.h>
#import <jsi/jsi.h>

namespace RNSkiaVideo {

using namespace facebook;

// The worklet runtime threads that drive video exports never drain their
// autorelease pool, so every autoreleased object created by a host function
// (Metal command buffers, CoreMedia wrappers, AVFoundation internals…) would
// accumulate for the lifetime of the app. JSI entry points doing ObjC work
// should run their body through this helper; errors are re-thrown as +1
// references so they survive the pool drain (never balanced — an error aborts
// the export).
template <typename F>
static jsi::Value runPooled(F&& body) {
  NSError* pendingError = nil;
  @autoreleasepool {
    try {
      body();
    } catch (NSError* error) {
      pendingError = error;
    }
  }
  if (pendingError) {
    throw (__bridge NSError*)CFBridgingRetain(pendingError);
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
