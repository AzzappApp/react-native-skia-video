#ifdef RCT_NEW_ARCH_ENABLED
#import "RNReactNativeSkiaVideoSpec.h"

@interface ReactNativeSkiaVideo : NSObject <NativeReactNativeSkiaVideoSpec>
#else
#import <React/RCTBridgeModule.h>

@interface ReactNativeSkiaVideo : NSObject <RCTBridgeModule>
#endif

@end
