cmake_minimum_required(VERSION 3.4.1)
project(ReactNativeSkiaVideo)

set(PACKAGE_NAME "react-native-skia-video")
set (CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -DFOLLY_NO_CONFIG=1")

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

unset(REACT_LIB CACHE)
unset(REACTNATIVEJNI_LIB CACHE)
unset(RUNTIMEEXECUTOR_LIB CACHE)
unset(TURBOMODULES_LIB CACHE)
if(${REACT_NATIVE_VERSION} GREATER_EQUAL 76)
        set (REACT_LIB "ReactAndroid::reactnative")
else()
        set (REACT_LIB "ReactAndroid::react_nativemodule_core")
        set (REACTNATIVEJNI_LIB "ReactAndroid::reactnativejni")
        set (RUNTIMEEXECUTOR_LIB "ReactAndroid::runtimeexecutor")
        set (TURBOMODULES_LIB "ReactAndroid::turbomodulejsijni")
endif()


if(${REACT_NATIVE_VERSION} GREATER_EQUAL 76)
        target_link_libraries(
                ${PACKAGE_NAME}
                ${LOG_LIB}
                android
                fbjni::fbjni
                ${REACT_LIB}
                ReactAndroid::jsi
                -ljnigraphics
                -lGLESv2
                -lEGL
                -landroid
        )
else()
        target_link_libraries(
                ${PACKAGE_NAME}
                ${LOG_LIB}
                android
                fbjni::fbjni
                ${REACT_LIB}
                ReactAndroid::jsi
                ${REACTNATIVEJNI_LIB}
                ${RUNTIMEEXECUTOR_LIB} 
                ${TURBOMODULES_LIB}
                -ljnigraphics
                -lGLESv2
                -lEGL
                -landroid
        )
endif()
