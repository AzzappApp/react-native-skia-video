//
//  VideoFrame.h
//  sheunglaili-react-native-skia-video
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

private:
  id<MTLTexture> mtlTexture;
  double width;
  double height;
  int rotation;
};

} // namespace RNSkiaVideo
