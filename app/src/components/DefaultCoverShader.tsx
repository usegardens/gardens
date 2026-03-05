import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Canvas, Skia, Shader, Fill, vec } from '@shopify/react-native-skia';

// SkSL shader for React Native Skia
const shaderSource = `
uniform float time;
uniform vec2 resolution;

// Simplex noise function
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  
  i = mod289(i);
  vec4 p = permute(permute(permute(
    i.z + vec4(0.0, i1.z, i2.z, 1.0))
    + i.y + vec4(0.0, i1.y, i2.y, 1.0))
    + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  
  vec4 x = x_ *ns.x + ns.yyyy;
  vec4 y = y_ *ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  
  vec4 s0 = floor(b0)*2.0 + 1.0;
  vec4 s1 = floor(b1)*2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  
  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
  
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;
  
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}

// Smooth color palette
vec3 palette(float t) {
  vec3 a = vec3(0.1, 0.1, 0.15);
  vec3 b = vec3(0.3, 0.2, 0.4);
  vec3 c = vec3(0.5, 0.4, 0.6);
  vec3 d = vec3(0.263, 0.416, 0.557);
  return a + b * cos(6.28318 * (c * t + d));
}

// In SkSL, main takes the fragment position as parameter and returns vec4
half4 main(vec2 fragCoord) {
  vec2 uv = fragCoord / resolution;
  
  // Create flowing noise pattern
  float noise1 = snoise(vec3(uv * 2.0, time * 0.1));
  float noise2 = snoise(vec3(uv * 4.0 + 100.0, time * 0.15));
  float noise3 = snoise(vec3(uv * 1.0 + 200.0, time * 0.05));
  
  float combinedNoise = noise1 * 0.5 + noise2 * 0.3 + noise3 * 0.2;
  
  // Create color based on position and noise
  float t = uv.x * 0.5 + uv.y * 0.3 + combinedNoise * 0.2;
  vec3 color = palette(t);
  
  // Add vignette
  float vignette = 1.0 - length((uv - 0.5) * 1.2);
  vignette = smoothstep(0.0, 0.7, vignette);
  color *= vignette * 0.8 + 0.2;
  
  // Add subtle gradient overlay
  vec3 gradientTop = vec3(0.05, 0.05, 0.1);
  vec3 gradientBottom = vec3(0.02, 0.02, 0.05);
  vec3 gradient = mix(gradientBottom, gradientTop, uv.y);
  
  // Blend gradient with noise
  color = mix(gradient, color, 0.6);
  
  return half4(half3(color), 1.0);
}
`;

interface DefaultCoverShaderProps {
  width: number;
  height: number;
}

export function DefaultCoverShader({ width, height }: DefaultCoverShaderProps) {
  const shader = Skia.RuntimeEffect.Make(shaderSource);
  
  if (!shader) {
    // Fallback to solid color if shader fails
    return (
      <View style={[styles.fallback, { width, height }]} />
    );
  }

  return (
    <View style={{ width, height }}>
      <Canvas style={{ width, height }}>
        <Fill>
          <Shader
            source={shader}
            uniforms={{
              time: 0,
              resolution: vec(width, height),
            }}
          />
        </Fill>
      </Canvas>
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: {
    backgroundColor: '#111',
  },
});
