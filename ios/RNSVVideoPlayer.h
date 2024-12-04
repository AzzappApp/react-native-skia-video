#import <AVFoundation/AVFoundation.h>
#import <Foundation/Foundation.h>
#import <Metal/Metal.h>

NS_ASSUME_NONNULL_BEGIN

@protocol RNSVVideoPlayerDelegate <NSObject>

- (void)readyToPlay:(NSDictionary*)assetInfos;
- (void)frameAvailable:(CMTime)time;
- (void)bufferingStart;
- (void)bufferingEnd;
- (void)bufferingUpdate:(NSArray<NSValue*>*)loadedTimeRanges;
- (void)videoError:(nullable NSError*)error;
- (void)complete;
- (void)isPlaying:(Boolean)playing;

@end

@interface RNSVVideoPlayer : NSObject

@property(nonatomic, readonly) CMTime currentTime;
@property(nonatomic, readonly) CMTime duration;
@property(nonatomic) float volume;
@property(nonatomic, readonly) BOOL disposed;
@property(nonatomic, readonly) BOOL isInitialized;
@property(nonatomic, readonly) BOOL isPlaying;
@property(nonatomic) BOOL isLooping;
@property(nonatomic) CGSize resolution;

- (instancetype)initWithURL:(NSURL*)url
                   delegate:(id<RNSVVideoPlayerDelegate>)delegate
                 resolution:(CGSize)resolution;
- (nullable id<MTLTexture>)getNextTextureForTime:(CMTime)time;
- (void)pause;
- (void)play;
- (void)seekTo:(CMTime)time completionHandler:(void (^)(BOOL))completionHandle;
- (void)dispose;
@end

NS_ASSUME_NONNULL_END
