//
//  MTLTextureUtils.h
//  azzapp-react-native-skia-video
//
//  Created by François de Campredon on 02/12/2024.
//

#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@interface MTLTextureUtils : NSObject

+ (nullable id<MTLTexture>)convertBGRACVPixelBufferRefToMTLTexture:
    (CVPixelBufferRef)pixelBuffer;

@end

NS_ASSUME_NONNULL_END
