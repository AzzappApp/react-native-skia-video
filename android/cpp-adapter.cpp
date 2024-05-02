#include <jni.h>
#include "azzapp-react-native-skia-video.h"

extern "C"
JNIEXPORT jdouble JNICALL
Java_com_azzapp_reactnativeskiavideo_ReactNativeSkiaVideoModule_nativeMultiply(JNIEnv *env, jclass type, jdouble a, jdouble b) {
    return azzapp_reactnativeskiavideo::multiply(a, b);
}
