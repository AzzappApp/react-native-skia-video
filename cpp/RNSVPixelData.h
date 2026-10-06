#pragma once

#include <jsi/jsi.h>

#include <cstddef>
#include <cstdint>
#include <string>

namespace RNSkiaVideo {

using namespace facebook;

/**
 * A view on the bytes of a JS Uint8Array, valid for as long as the array is
 * alive (in practice: during the host function call that received it).
 */
struct PixelData {
  const uint8_t* data;
  size_t size;
};

inline PixelData getPixelData(jsi::Runtime& runtime, const jsi::Value& value,
                              const char* caller) {
  auto error = std::string(caller) + " expects a Uint8Array of pixels!";
  if (!value.isObject()) {
    throw jsi::JSError(runtime, error);
  }
  auto array = value.asObject(runtime);
  auto bufferValue = array.getProperty(runtime, "buffer");
  auto offsetValue = array.getProperty(runtime, "byteOffset");
  auto lengthValue = array.getProperty(runtime, "byteLength");
  if (!bufferValue.isObject() || !offsetValue.isNumber() ||
      !lengthValue.isNumber()) {
    throw jsi::JSError(runtime, error);
  }
  auto bufferObject = bufferValue.asObject(runtime);
  if (!bufferObject.isArrayBuffer(runtime)) {
    throw jsi::JSError(runtime, error);
  }
  auto buffer = bufferObject.getArrayBuffer(runtime);
  auto offset = static_cast<size_t>(offsetValue.asNumber());
  auto length = static_cast<size_t>(lengthValue.asNumber());
  if (offset + length > buffer.size(runtime)) {
    throw jsi::JSError(runtime, error);
  }
  return {buffer.data(runtime) + offset, length};
}

} // namespace RNSkiaVideo
