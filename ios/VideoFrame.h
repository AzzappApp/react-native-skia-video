//
//  VideoFrame.h
//  azzapp-react-native-skia-video
//
//  Created by François de Campredon on 22/05/2024.
//

#pragma once
#import <Metal/Metal.h>
#import <jsi/jsi.h>

namespace RNSkiaVideo {
using namespace facebook;

class JSI_EXPORT VideoFrame : public jsi::HostObject {
public:
  VideoFrame(id<MTLTexture> mtlTexture, double width, double height,
             int rotation);

  std::vector<jsi::PropNameID> getPropertyNames(jsi::Runtime& rt) override;
  jsi::Value get(jsi::Runtime&, const jsi::PropNameID& name) override;

  /**
   * Whether this frame already describes the given texture and geometry, in
   * which case it can be handed out again instead of allocating a new one.
   */
  bool matches(id<MTLTexture> texture, double width, double height,
               int rotation) const;

private:
  id<MTLTexture> mtlTexture;
  double width;
  double height;
  int rotation;
};

} // namespace RNSkiaVideo
