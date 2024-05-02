#ifdef __cplusplus
#import "azzapp-react-native-skia-video.h"
#endif

#ifdef RCT_NEW_ARCH_ENABLED
#import "RNReactNativeSkiaVideoSpec.h"

@interface ReactNativeSkiaVideo : NSObject <NativeReactNativeSkiaVideoSpec>
#else
#import <React/RCTBridgeModule.h>

@interface ReactNativeSkiaVideo : NSObject <RCTBridgeModule>
#endif

@end
