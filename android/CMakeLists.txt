cmake_minimum_required(VERSION 3.4.1)
project(ReactNativeSkiaVideo)

set(PACKAGE_NAME "react-native-skia-video")

set(CMAKE_VERBOSE_MAKEFILE ON)
set(CMAKE_CXX_STANDARD 17)

set(build_DIR ${CMAKE_SOURCE_DIR}/build)

file(GLOB libfbjni_include_DIRS "${build_DIR}/fbjni-*-headers.jar/")

# Consume shared libraries and headers from prefabs
find_package(fbjni REQUIRED CONFIG)
find_package(ReactAndroid REQUIRED CONFIG)

add_library(${PACKAGE_NAME}
        SHARED
        ../cpp/EventEmitter.h
        ../cpp/EventEmitter.cpp
        cpp/cpp-adapter.cpp
        cpp/NativeEventDispatcher.h
        cpp/NativeEventDispatcher.cpp
        cpp/JNIHelpers.h
        cpp/JNIHelpers.cpp
        cpp/VideoCompositionFramesExtractorHostObject.h
        cpp/VideoCompositionFramesExtractorHostObject.cpp
        cpp/VideoPlayerHostObject.h
        cpp/VideoPlayerHostObject.cpp
        cpp/VideoCapabilities.h
        cpp/VideoCapabilities.cpp
        cpp/VideoComposition.h
        cpp/VideoComposition.cpp
        cpp/VideoCompositionExporter.h
        cpp/VideoCompositionExporter.cpp
        cpp/VideoCompositionFramesExtractor.h
        cpp/VideoCompositionFramesExtractor.cpp
        cpp/VideoPlayer.h
        cpp/VideoPlayer.cpp
        cpp/VideoFrame.h
        cpp/VideoFrame.cpp
)

# Specifies a path to native header files.
include_directories(
        ../cpp/
        cpp/

        # React native
        "${NODE_MODULES_DIR}/react-native/ReactCommon/callinvoker"
        "${NODE_MODULES_DIR}/react-native/ReactCommon/jsi"
        "${NODE_MODULES_DIR}/react-native/ReactCommon"
        "${NODE_MODULES_DIR}/react-native/ReactCommon/react/nativemodule/core"
        "${NODE_MODULES_DIR}/react-native/ReactAndroid/src/main/java/com/facebook/react/turbomodule/core/jni"

        ${libfbjni_include_DIRS}
)


find_library(
        LOG_LIB
        log
)

add_definitions(-DGL_GLEXT_PROTOTYPES)
add_definitions(-DEGL_EGLEXT_PROTOTYPES)

target_link_libraries(
        ${PACKAGE_NAME}
        ${LOG_LIB}
        android
        fbjni::fbjni
        ReactAndroid::react_nativemodule_core
        ReactAndroid::jsi
        ReactAndroid::reactnativejni  
        ReactAndroid::runtimeexecutor  
        ReactAndroid::turbomodulejsijni
        -ljnigraphics
        -lGLESv2
        -lEGL
        -landroid
)

find_package(shopify_react-native-skia REQUIRED CONFIG)
target_link_libraries(
        ${PACKAGE_NAME}
        shopify_react-native-skia::rnskia
)

get_target_property(RN_SKIA_INCLUDE_DIR shopify_react-native-skia::rnskia INTERFACE_INCLUDE_DIRECTORIES)
include_directories("${RN_SKIA_INCLUDE_DIR}/react-native-skia")


set(RN_SKIA_DIR "${NODE_MODULES_DIR}/@shopify/react-native-skia")
file(GLOB skiaLibraries "${RN_SKIA_DIR}/libs/android/${ANDROID_ABI}/*.a")
foreach(skiaLibrary ${skiaLibraries})
  target_link_libraries(${PACKAGE_NAME} "${skiaLibrary}")
endforeach()

find_package(react-native-reanimated REQUIRED CONFIG)
target_link_libraries(
        ${PACKAGE_NAME}
        react-native-reanimated::reanimated
)