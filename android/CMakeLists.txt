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
find_package(shopify_react-native-skia REQUIRED CONFIG)
find_package(react-native-reanimated REQUIRED CONFIG)

set(JSI_LIB ReactAndroid::jsi)
message("-- JSI     : " ${JSI_LIB})
set(FBJNI_LIBRARY fbjni::fbjni)
message("-- FBJNI   : " ${FBJNI_LIBRARY})
set(REACT_LIB ReactAndroid::react_nativemodule_core)
message("-- REACT   : " ${REACT_LIB})
set(TURBOMODULES_LIB "ReactAndroid::turbomodulejsijni")
message("-- TURBO   : " ${TURBOMODULES_LIB})
set(RNSKIA_LIB shopify_react-native-skia::rnskia)
message("-- RNSKIA  : " ${RNSKIA_LIB})
set(REANIMATED_LIB react-native-reanimated::reanimated)
message("-- REANIMATED  : " ${REANIMATED_LIB})


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
        "${NODE_MODULES_DIR}/react-native/ReactCommon/runtimeexecutor"
        "${NODE_MODULES_DIR}/react-native/ReactCommon"
        "${NODE_MODULES_DIR}/react-native/ReactCommon/react/nativemodule/core"
        "${NODE_MODULES_DIR}/react-native/ReactAndroid/src/main/java/com/facebook/react/turbomodule/core/jni"

        # include skia headers
        "${NODE_MODULES_DIR}/@shopify/react-native-skia/cpp/rnskia"
        "${NODE_MODULES_DIR}/@shopify/react-native-skia/cpp/skia/include/config/"
        "${NODE_MODULES_DIR}/@shopify/react-native-skia/cpp/skia/include/core/"
        "${NODE_MODULES_DIR}/@shopify/react-native-skia/cpp/skia/include/effects/"
        "${NODE_MODULES_DIR}/@shopify/react-native-skia/cpp/skia/include/utils/"
        "${NODE_MODULES_DIR}/@shopify/react-native-skia/cpp/skia/include/pathops/"
        "${NODE_MODULES_DIR}/@shopify/react-native-skia/cpp/skia/modules/"
        "${NODE_MODULES_DIR}/@shopify/react-native-skia/cpp/skia/modules/skparagraph/include/"
        "${NODE_MODULES_DIR}/@shopify/react-native-skia/cpp/skia/modules/skresources/include/"
        "${NODE_MODULES_DIR}/@shopify/react-native-skia/cpp/skia/include/"
        "${NODE_MODULES_DIR}/@shopify/react-native-skia/cpp/skia"

        "${NODE_MODULES_DIR}/@shopify/react-native-skia/cpp/api"
        "${NODE_MODULES_DIR}/@shopify/react-native-skia/cpp/jsi"
        "${NODE_MODULES_DIR}/@shopify/react-native-skia/cpp/rnskia"
        "${NODE_MODULES_DIR}/@shopify/react-native-skia/cpp/rnskia/values"
        "${NODE_MODULES_DIR}/@shopify/react-native-skia/cpp/rnskia/dom"
        "${NODE_MODULES_DIR}/@shopify/react-native-skia/cpp/rnskia/dom/base"
        "${NODE_MODULES_DIR}/@shopify/react-native-skia/cpp/rnskia/dom/nodes"
        "${NODE_MODULES_DIR}/@shopify/react-native-skia/cpp/rnskia/dom/props"
        "${NODE_MODULES_DIR}/@shopify/react-native-skia/cpp/utils"
        "${NODE_MODULES_DIR}/@shopify/react-native-skia/android/cpp/jni/include"
        "${NODE_MODULES_DIR}/@shopify/react-native-skia/android/cpp/rnskia-android"

        ${libfbjni_include_DIRS}
)


# Import prebuilt skia library
set(SKIA_LIBS_PATH "${NODE_MODULES_DIR}/@shopify/react-native-skia/libs/android/${ANDROID_ABI}")

set(SKIA_LIB "skia")
add_library(skia STATIC IMPORTED)
set_property(TARGET skia PROPERTY IMPORTED_LOCATION "${SKIA_LIBS_PATH}/libskia.a")

set(SKIA_SVG "svg")
add_library(svg STATIC IMPORTED)
set_property(TARGET svg PROPERTY IMPORTED_LOCATION "${SKIA_LIBS_PATH}/libsvg.a")

set(SKIA_SKSHAPER_LIB "skshaper")
add_library(skshaper STATIC IMPORTED)
set_property(TARGET skshaper PROPERTY IMPORTED_LOCATION "${SKIA_LIBS_PATH}/libskshaper.a")

set(SKIA_MODULE_SKSG_LIB "sksg")
add_library(sksg STATIC IMPORTED)
set_property(TARGET sksg PROPERTY IMPORTED_LOCATION "${SKIA_LIBS_PATH}/libsksg.a")

set(SKIA_MODULE_SKUNICODE_LIB "skunicode")
add_library(skunicode STATIC IMPORTED)
set_property(TARGET skunicode PROPERTY IMPORTED_LOCATION "${SKIA_LIBS_PATH}/libskunicode.a")


# Android Log lib
find_library(LOG_LIB  log)


add_definitions(-DGL_GLEXT_PROTOTYPES)
add_definitions(-DEGL_EGLEXT_PROTOTYPES)

# Link
target_link_libraries(
        ${PACKAGE_NAME}
        ${LOG_LIB}
        ${REANIMATED_LIB}
        ${FBJNI_LIBRARY}
        ${REACT_LIB}
        ${JSI_LIB}
        ${TURBOMODULES_LIB}
        ${SKIA_SKSHAPER_LIB}
        ${SKIA_SVG}
        ${SKIA_MODULE_SKSG_LIB}
        ${SKIA_MODULE_SKUNICODE_LIB}
        ${SKIA_LIB}
        ${RNSKIA_LIB}
        -ljnigraphics
        -lGLESv2
        -lEGL
        -landroid
)
