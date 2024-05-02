cmake_minimum_required(VERSION 3.4.1)
project(ReactNativeSkiaVideo)

set (CMAKE_VERBOSE_MAKEFILE ON)
set (CMAKE_CXX_STANDARD 14)

add_library(azzapp-react-native-skia-video            SHARED
            ../cpp/azzapp-react-native-skia-video.cpp
            cpp-adapter.cpp
)

# Specifies a path to native header files.
include_directories(
            ../cpp
)
