//
//  VideoFrame.h
//  azzapp-react-native-skia-video
//
//  Created by François de Campredon on 22/05/2024.
//

#pragma once
#import <CoreVideo/CoreVideo.h>
#import <Metal/Metal.h>
#import <jsi/jsi.h>

namespace RNSkiaVideo {
using namespace facebook;

class JSI_EXPORT VideoFrame : public jsi::HostObject {
public:
  VideoFrame(id<MTLTexture> mtlTexture, double width, double height,
             int rotation);
  ~VideoFrame() override;

  std::vector<jsi::PropNameID> getPropertyNames(jsi::Runtime& rt) override;
  jsi::Value get(jsi::Runtime&, const jsi::PropNameID& name) override;

  /**
   * Whether this frame already describes the given texture and geometry, in
   * which case it can be handed out again instead of allocating a new one.
   */
  bool matches(id<MTLTexture> texture, double width, double height,
               int rotation) const;

  /**
   * Direct texture mode: the frame takes ownership of the decoder's pixel
   * buffer and of the Metal texture wrapping it (both +1 references) and keeps
   * them alive until releaseBacking() or its destruction. A frame without a
   * backing points to a texture owned and recycled by the player.
   */
  void adoptBacking(CVPixelBufferRef pixelBuffer,
                    CVMetalTextureRef metalTexture);
  /**
   * Hands the pixel buffer back to its pool. The texture object itself stays
   * valid, its content is simply not guaranteed anymore.
   */
  void releaseBacking();

private:
  id<MTLTexture> mtlTexture;
  double width;
  double height;
  int rotation;
  CVPixelBufferRef pixelBuffer = NULL;
  CVMetalTextureRef metalTexture = NULL;
};

} // namespace RNSkiaVideo
