#include "JSIJNIConversion.h"
#include <fbjni/fbjni.h>
#include <jsi/jsi.h>

namespace RNSkiaVideo {

using namespace facebook;

jsi::Value JSIJNIConversion::convertJNIObjectToJSIValue(
    jsi::Runtime& runtime, const jni::alias_ref<jobject>& object) {
  if (!object) {
    // null

    return jsi::Value::null();
  } else if (object->isInstanceOf(jni::JBoolean::javaClassStatic())) {
    // Boolean

    auto boxed = static_ref_cast<jni::JBoolean>(object);
    bool value = boxed->value();
    return jsi::Value(value);
  } else if (object->isInstanceOf(jni::JLong::javaClassStatic())) {
    // Long

    auto boxed = static_ref_cast<jni::JLong>(object);
    double value = boxed->value();
    return jsi::Value(value);
  } else if (object->isInstanceOf(jni::JDouble::javaClassStatic())) {
    // Double

    auto boxed = static_ref_cast<jni::JDouble>(object);
    double value = boxed->value();
    return jsi::Value(value);
  } else if (object->isInstanceOf(jni::JInteger::javaClassStatic())) {
    // Integer

    auto boxed = static_ref_cast<jni::JInteger>(object);
    return jsi::Value(boxed->value());
  } else if (object->isInstanceOf(jni::JString::javaClassStatic())) {
    // String

    return jsi::String::createFromUtf8(runtime, object->toString());
  } else if (object->isInstanceOf(jni::JList<jobject>::javaClassStatic())) {
    // List<E>

    auto arrayList = static_ref_cast<jni::JList<jobject>>(object);
    auto size = arrayList->size();

    auto result = jsi::Array(runtime, size);
    size_t i = 0;
    for (const auto& item : *arrayList) {
      result.setValueAtIndex(runtime, i,
                             convertJNIObjectToJSIValue(runtime, item));
      i++;
    }
    return result;
  } else if (object->isInstanceOf(
                 jni::JMap<jstring, jobject>::javaClassStatic())) {
    // Map<K, V>

    auto map = static_ref_cast<jni::JMap<jstring, jobject>>(object);

    auto result = jsi::Object(runtime);
    for (const auto& entry : *map) {
      auto key = entry.first->toString();
      auto value = entry.second;
      auto jsiValue = convertJNIObjectToJSIValue(runtime, value);
      result.setProperty(runtime, key.c_str(), jsiValue);
    }
    return result;
  }

  auto type = object->getClass()->toString();
  auto message = "Received unknown JNI type \"" + type +
                 "\"! Cannot convert to jsi::Value.";
  throw std::runtime_error(message);
}

} // namespace RNSkiaVideo
