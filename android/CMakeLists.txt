cmake_minimum_required(VERSION 3.22.1)
project(ReactNativeSkiaVideo)

set(PACKAGE_NAME "react-native-skia-video")
set (CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -DFOLLY_NO_CONFIG=1")

set(CMAKE_VERBOSE_MAKEFILE ON)
set(CMAKE_CXX_STANDARD 20)

set(build_DIR ${CMAKE_SOURCE_DIR}/build)

file(GLOB libfbjni_include_DIRS "${build_DIR}/fbjni-*-headers.jar/")


# Consume shared libraries and headers from prefabs
find_package(fbjni REQUIRED CONFIG)
find_package(ReactAndroid REQUIRED CONFIG)

add_library(${PACKAGE_NAME}
        SHARED
        ../cpp/EventEmitter.h
        ../cpp/EventEmitter.cpp
        cpp/JNIHelpers.h
        cpp/JNIHelpers.cpp
        cpp/cpp-adapter.cpp
        cpp/NativeEventDispatcher.h
        cpp/NativeEventDispatcher.cpp
        cpp/SkiaContextHolder.h
        cpp/SkiaContextHolder.cpp
        cpp/VideoCapabilities.h
        cpp/VideoCapabilities.cpp
        cpp/VideoComposition.h
        cpp/VideoComposition.cpp
        cpp/VideoCompositionFramesExtractor.h
        cpp/VideoCompositionFramesExtractor.cpp
        cpp/VideoCompositionFramesExtractorHostObject.h
        cpp/VideoCompositionFramesExtractorHostObject.cpp
        cpp/VideoCompositionFramesExtractorSyncHostObject.h
        cpp/VideoCompositionFramesExtractorSyncHostObject.cpp
        cpp/VideoEncoderHostObject.h
        cpp/VideoEncoderHostObject.cpp
        cpp/VideoPlayerHostObject.h
        cpp/VideoPlayerHostObject.cpp
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

target_link_libraries(
        ${PACKAGE_NAME}
        ${LOG_LIB}
        android
        fbjni::fbjni
        ReactAndroid::reactnative
        ReactAndroid::jsi
        -ljnigraphics
        -lGLESv2
        -lEGL
        -landroid
)


# Enable Android 16kb native library alignment
if(CMAKE_ANDROID_NDK_VERSION VERSION_LESS "27")
    target_link_options(${PACKAGE_NAME} PRIVATE "-Wl,-z,max-page-size=16384")
endif()
