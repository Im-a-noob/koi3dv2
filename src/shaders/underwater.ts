import * as THREE from "three";

export const CAUSTIC_GLSL = /* glsl */ `
float causticF(vec2 uv, float t) {
  vec2 p = mod(uv * 6.28318, 6.28318) - 250.0;
  vec2 i = p;
  float c = 1.0;
  float inten = 0.005;
  for (int n = 0; n < 4; n++) {
    float tt = t * (1.0 - (3.5 / float(n + 1)));
    i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / inten), p.y / (cos(i.y + tt) / inten)));
  }
  c /= 4.0;
  c = 1.17 - pow(c, 1.4);
  return pow(abs(c), 8.0);
}
`;

export interface UnderwaterUniforms {
  uTime: { value: number };
  uSunCol: { value: THREE.Color };
  uWaterCol: { value: THREE.Color };
  uAbsorb: { value: THREE.Vector3 };
  uCausticAmt: { value: number };
  uSnowCover: { value: number };
  uDry: { value: number };
}

export const sharedUniforms: UnderwaterUniforms = {
  uTime: { value: 0 },
  uSunCol: { value: new THREE.Color() },
  uWaterCol: { value: new THREE.Color() },
  uAbsorb: { value: new THREE.Vector3(0.45, 0.13, 0.18) },
  uCausticAmt: { value: 1.0 },
  uSnowCover: { value: 0 },
  uDry: { value: 0 },
};

export function underwater<T extends THREE.Material>(
  mat: T,
  { caustic = 1, snow = 1, dry = false }: { caustic?: number; snow?: number; dry?: boolean } = {}
): T {
  const defs: Record<string, string> = { ...((mat as any).defines || {}) };
  if (snow > 0) defs.SNOWY = "";
  if (dry) defs.DRYABLE = "";
  (mat as any).defines = defs;

  mat.onBeforeCompile = (sh) => {
    for (const k of Object.keys(sharedUniforms)) {
      sh.uniforms[k] = (sharedUniforms as any)[k];
    }
    sh.uniforms.uCausticScale = { value: caustic };
    sh.uniforms.uSnowAmt = { value: snow };

    sh.vertexShader =
      "varying vec3 vWPos;\n" +
      sh.vertexShader.replace(
        "#include <project_vertex>",
        `#include <project_vertex>
      vec4 wp4 = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        wp4 = instanceMatrix * wp4;
      #endif
      vWPos = (modelMatrix * wp4).xyz;`
      );

    sh.fragmentShader =
      `varying vec3 vWPos;
      uniform float uTime;
      uniform vec3 uSunCol;
      uniform vec3 uWaterCol;
      uniform vec3 uAbsorb;
      uniform float uCausticAmt;
      uniform float uCausticScale;
      uniform float uSnowCover;
      uniform float uSnowAmt;
      uniform float uDry;
      ${CAUSTIC_GLSL}
      ` +
      sh.fragmentShader
        .replace(
          "#include <normal_fragment_maps>",
          `#include <normal_fragment_maps>
      #ifdef DRYABLE
      if (vWPos.y > 0.0) {
        float lum = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
        float dm = smoothstep(0.02, 0.12, vWPos.y);
        vec3 dryC = vec3(0.36, 0.26, 0.12) * (0.7 + lum * 3.0);
        vec3 lushC = diffuseColor.rgb * vec3(0.8, 1.22, 0.72);
        diffuseColor.rgb = uDry >= 0.0 ? mix(diffuseColor.rgb, dryC, uDry * dm) : mix(diffuseColor.rgb, lushC, -uDry * dm * 2.0);
      }
      #endif
      #ifdef SNOWY
      if (uSnowCover > 0.001) {
        vec3 upS = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
        float sp = fract(sin(dot(floor(vWPos.xz * 22.0), vec2(12.9898, 78.233))) * 43758.5453);
        float big = fract(sin(dot(floor(vWPos.xz * 3.0), vec2(39.34, 11.13))) * 24634.63);
        float fac = dot(normal, upS) + (sp - 0.5) * 0.3;
        float m = smoothstep(0.2, 0.62, fac) * smoothstep(0.01, 0.05, vWPos.y)
                * clamp(uSnowCover * 1.35 - sp * 0.25 - big * 0.2, 0.0, 1.0) * uSnowAmt;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9, 0.92, 0.96) * (0.94 + 0.06 * sp), m);
        roughnessFactor = mix(roughnessFactor, 0.75, m);
      }
      #endif
      `
        )
        .replace(
          "#include <opaque_fragment>",
          `if (vWPos.y < 0.0) {
        vec3 upV = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
        float uwD = -vWPos.y;
        float facing = clamp(dot(normal, upV), 0.0, 1.0);
        float cs = causticF(vWPos.xz * 0.085, uTime * 0.55) * 0.65 + causticF(vWPos.xz * 0.121 + vec2(0.37, 0.11), uTime * 0.63) * 0.5;
        outgoingLight += diffuseColor.rgb * uSunCol * cs * uCausticAmt * uCausticScale * facing * exp(-uwD * 0.3) * smoothstep(0.0, 0.15, uwD);
        vec3 ab = exp(-uAbsorb * uwD);
        outgoingLight = mix(outgoingLight * ab, uWaterCol, 1.0 - exp(-0.3 * uwD));
      }
      #include <opaque_fragment>`
        );
  };
  return mat;
}

/**
 * Fin-specific underwater shader with translucent thin-membrane transmission,
 * soft organic alpha gradient feathering, and wet satin sheen.
 */
export function underwaterFin<T extends THREE.Material>(
  mat: T,
  { caustic = 0.45, snow = 0 }: { caustic?: number; snow?: number } = {}
): T {
  const defs: Record<string, string> = { ...((mat as any).defines || {}) };
  if (snow > 0) defs.SNOWY = "";
  defs.TRANSLUCENT_FIN = "";
  (mat as any).defines = defs;

  mat.onBeforeCompile = (sh) => {
    for (const k of Object.keys(sharedUniforms)) {
      sh.uniforms[k] = (sharedUniforms as any)[k];
    }
    sh.uniforms.uCausticScale = { value: caustic };
    sh.uniforms.uSnowAmt = { value: snow };

    sh.vertexShader =
      "varying vec3 vWPos;\n" +
      sh.vertexShader.replace(
        "#include <project_vertex>",
        `#include <project_vertex>
      vec4 wp4 = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        wp4 = instanceMatrix * wp4;
      #endif
      vWPos = (modelMatrix * wp4).xyz;`
      );

    sh.fragmentShader =
      `varying vec3 vWPos;
      uniform float uTime;
      uniform vec3 uSunCol;
      uniform vec3 uWaterCol;
      uniform vec3 uAbsorb;
      uniform float uCausticAmt;
      uniform float uCausticScale;
      uniform float uSnowCover;
      uniform float uSnowAmt;
      uniform float uDry;
      ${CAUSTIC_GLSL}
      ` +
      sh.fragmentShader
        .replace(
          "#include <map_fragment>",
          `#include <map_fragment>
      #ifdef USE_MAP
        // Soft organic alpha gradient along the fin membrane:
        // vMapUv.x is distance from root (0.0) to tip (1.0)
        // vMapUv.y is lateral position (0.0 to 1.0, 0.5 is centerline)
        float uDist = clamp(vMapUv.x, 0.0, 1.0);
        float edgeDist = 1.0 - abs(vMapUv.y - 0.5) * 2.0;
        float edgeFeather = smoothstep(0.0, 0.28, edgeDist);

        // Smooth cubic fade from dense root (0.95) to ethereal translucent tips (0.16)
        float tipTranslucency = mix(1.0, 0.18, pow(uDist, 1.25));
        diffuseColor.a *= tipTranslucency * mix(0.55, 1.0, edgeFeather);
      #endif
      `
        )
        .replace(
          "#include <opaque_fragment>",
          `
        // Thin Translucent Membrane Backlit Transmission Glow:
        vec3 finViewDir = normalize(vViewPosition);
        vec3 finSunDir = normalize(vec3(0.35, 0.9, 0.35));
        
        // Light passing through the thin fin membrane from the rear:
        float backScatter = pow(clamp(dot(finViewDir, -finSunDir), 0.0, 1.0), 2.2);
        float wrapLight = clamp(dot(normal, finSunDir) * 0.5 + 0.5, 0.0, 1.0);
        vec3 subSurfaceGlow = diffuseColor.rgb * (uSunCol + vec3(0.2, 0.15, 0.12)) * (backScatter * 0.65 + wrapLight * 0.3);
        
        // Wet satin Fresnel sheen along grazing angles:
        float nDotV = abs(dot(normal, finViewDir));
        float finFresnel = pow(1.0 - nDotV, 3.2) * 0.32;
        
        outgoingLight += subSurfaceGlow * (1.0 - diffuseColor.a * 0.45) + vec3(0.88, 0.94, 1.0) * finFresnel;

        if (vWPos.y < 0.0) {
          vec3 upV = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
          float uwD = -vWPos.y;
          float facing = clamp(dot(normal, upV), 0.0, 1.0);
          float cs = causticF(vWPos.xz * 0.085, uTime * 0.55) * 0.65 + causticF(vWPos.xz * 0.121 + vec2(0.37, 0.11), uTime * 0.63) * 0.5;
          outgoingLight += diffuseColor.rgb * uSunCol * cs * uCausticAmt * uCausticScale * facing * exp(-uwD * 0.3) * smoothstep(0.0, 0.15, uwD);
          vec3 ab = exp(-uAbsorb * uwD);
          outgoingLight = mix(outgoingLight * ab, uWaterCol, 1.0 - exp(-0.3 * uwD));
        }
        #include <opaque_fragment>`
        );
  };
  return mat;
}
