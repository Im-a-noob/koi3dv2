import * as THREE from "three";
import { KoiVariety } from "../types/koi";
import { TAU } from "../math/noise";

interface PatchDef {
  pos: number;
  len: number;
  width: number;
  offset: number; // offset from dorsal centerline (v = 0.5)
  kind: "accent" | "marking";
  phase: number;
}

const TEXTURE_PATTERNS: Record<KoiVariety, PatchDef[]> = {
  // Kohaku: 3-step traditional Sandan Hi (red) on pure white base
  kohaku: [
    { pos: 0.17, len: 0.095, width: 0.72, offset: 0.03, kind: "accent", phase: 0.3 },
    { pos: 0.48, len: 0.118, width: 0.68, offset: -0.09, kind: "accent", phase: 1.9 },
    { pos: 0.76, len: 0.086, width: 0.60, offset: 0.11, kind: "accent", phase: 3.6 },
  ],
  // Sanke: 2 large Hi (red) patches + 3 inky black Sumi stepping stones
  sanke: [
    { pos: 0.19, len: 0.098, width: 0.70, offset: 0.03, kind: "accent", phase: 0.4 },
    { pos: 0.58, len: 0.108, width: 0.65, offset: -0.11, kind: "accent", phase: 2.2 },
    { pos: 0.38, len: 0.052, width: 0.32, offset: 0.28, kind: "marking", phase: 4.1 },
    { pos: 0.68, len: 0.048, width: 0.30, offset: 0.22, kind: "marking", phase: 1.3 },
    { pos: 0.80, len: 0.044, width: 0.28, offset: -0.26, kind: "marking", phase: 5.2 },
  ],
  // Showa: Bold black Sumi base with Menware lightning V on head + red & white patches
  showa: [
    { pos: 0.12, len: 0.075, width: 0.48, offset: -0.02, kind: "marking", phase: 0.9 },
    { pos: 0.34, len: 0.115, width: 0.82, offset: 0.06, kind: "marking", phase: 2.7 },
    { pos: 0.73, len: 0.112, width: 0.76, offset: -0.10, kind: "marking", phase: 4.9 },
    { pos: 0.17, len: 0.086, width: 0.62, offset: 0.05, kind: "accent", phase: 1.6 },
    { pos: 0.53, len: 0.102, width: 0.60, offset: 0.12, kind: "accent", phase: 3.8 },
  ],
  // Ogon: Solid metallic gold (no patches)
  ogon: [],
  // Tancho: Pure white body with a single circular crimson sun disc on forehead
  tancho: [
    { pos: 0.155, len: 0.072, width: 0.52, offset: 0.0, kind: "accent", phase: 0.0 },
  ],
  // Shiro Utsuri: Graphic bold black Sumi patches on snowy white skin
  utsuri: [
    { pos: 0.22, len: 0.105, width: 0.72, offset: 0.06, kind: "marking", phase: 0.7 },
    { pos: 0.51, len: 0.112, width: 0.66, offset: -0.14, kind: "marking", phase: 2.5 },
    { pos: 0.79, len: 0.085, width: 0.58, offset: 0.16, kind: "marking", phase: 4.6 },
  ],
  // Asagi: Matsuba diamond net scales on back, vermilion red on cheeks/flanks
  asagi: [],
};

const textureCache = new Map<string, THREE.CanvasTexture>();

/**
 * Generate a high-resolution vector texture for a 3D Koi fish
 */
export function getKoiTexture(variety: KoiVariety, seed: number): THREE.CanvasTexture {
  const cacheKey = `${variety}_${Math.floor(seed % 30)}`;
  if (textureCache.has(cacheKey)) {
    return textureCache.get(cacheKey)!;
  }

  const W = 1024;
  const H = 512;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    const fallback = new THREE.CanvasTexture(canvas);
    return fallback;
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  // Individual fish variation
  const dSeed = (seed % 100) * 0.0006;
  const pSeed = (seed % 50) * 0.05;

  // 1. Draw Base Skin
  if (variety === "ogon") {
    // Yamabuki Ogon metallic gold gradient
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0.0, "#c98220");
    grad.addColorStop(0.2, "#e5a72e");
    grad.addColorStop(0.5, "#fad860"); // golden dorsal crest
    grad.addColorStop(0.8, "#e5a72e");
    grad.addColorStop(1.0, "#c98220");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
  } else if (variety === "asagi") {
    // Asagi: Blue back, creamy belly
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0.0, "#ede5d8");
    grad.addColorStop(0.22, "#ede5d8");
    grad.addColorStop(0.32, "#4a687d");
    grad.addColorStop(0.5, "#334c5e"); // slate blue dorsal
    grad.addColorStop(0.68, "#4a687d");
    grad.addColorStop(0.78, "#ede5d8");
    grad.addColorStop(1.0, "#ede5d8");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
  } else {
    // Classic Shiroji: Pearlescent porcelain white skin
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0.0, "#ded4c5");
    grad.addColorStop(0.18, "#ede4d5");
    grad.addColorStop(0.5, "#fbf8f2"); // glowing white dorsal ridge
    grad.addColorStop(0.82, "#ede4d5");
    grad.addColorStop(1.0, "#ded4c5");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
  }

  // 2. Draw Scales Lattice (Matsuba / Ginrin Sheen)
  if (variety === "asagi") {
    // Crisp diamond net reticulation on Asagi back
    ctx.strokeStyle = "rgba(22, 34, 44, 0.75)";
    ctx.lineWidth = 1.5;
    const stepU = 14;
    const stepV = 10;
    const startU = 0.16 * W;
    const endU = 0.88 * W;
    const startV = 0.3 * H;
    const endV = 0.7 * H;

    for (let u = startU; u <= endU; u += stepU) {
      for (let v = startV; v <= endV; v += stepV) {
        ctx.beginPath();
        ctx.moveTo(u, v);
        ctx.lineTo(u + stepU * 0.5, v + stepV * 0.5);
        ctx.lineTo(u, v + stepV);
        ctx.stroke();

        // Little diamond center dot
        ctx.fillStyle = "rgba(215, 230, 245, 0.45)";
        ctx.fillRect(u + stepU * 0.25 - 1, v + stepV * 0.5 - 1, 2.5, 2.5);
      }
    }

    // Cheeks & ventral vermilion red
    ctx.fillStyle = "#df4228";
    // Left cheek
    ctx.beginPath();
    ctx.ellipse(0.19 * W, 0.24 * H, 0.05 * W, 0.06 * H, 0.2, 0, TAU);
    ctx.fill();
    // Right cheek
    ctx.beginPath();
    ctx.ellipse(0.19 * W, 0.76 * H, 0.05 * W, 0.06 * H, -0.2, 0, TAU);
    ctx.fill();
    // Ventral flank stripes
    ctx.fillStyle = "rgba(223, 66, 40, 0.9)";
    ctx.fillRect(0.24 * W, 0.16 * H, 0.58 * W, 0.08 * H);
    ctx.fillRect(0.24 * W, 0.76 * H, 0.58 * W, 0.08 * H);
  } else if (variety === "ogon") {
    // Golden Fukurin scale grid
    ctx.strokeStyle = "rgba(255, 245, 180, 0.35)";
    ctx.lineWidth = 1.2;
    for (let u = 0.16 * W; u <= 0.86 * W; u += 18) {
      ctx.beginPath();
      ctx.arc(u, 0.5 * H, 14, -Math.PI * 0.45, Math.PI * 0.45);
      ctx.stroke();
    }
  } else {
    // Subtle translucent pearlescent scales for Kohaku/Sanke/Showa/Tancho
    ctx.strokeStyle = "rgba(255, 255, 255, 0.22)";
    ctx.lineWidth = 1.2;
    for (let u = 0.18 * W; u <= 0.86 * W; u += 20) {
      for (let v = 0.32 * H; v <= 0.68 * H; v += 18) {
        ctx.beginPath();
        ctx.arc(u, v, 9, -Math.PI * 0.4, Math.PI * 0.4);
        ctx.stroke();
      }
    }
  }

  // 3. Draw Vector Patches (Nagomi Patches with Harmonic Wobble)
  const patches = TEXTURE_PATTERNS[variety] || [];

  // Colors
  const HI_RED = "#dc3c22";
  const HI_RED_GRAD = "#ef4e32";
  const SUMI_BLACK = "#181a17";
  const SUMI_BLACK_SOFT = "#242722";

  // First pass: Accent patches (Hi Red)
  for (const patch of patches) {
    if (patch.kind !== "accent") continue;

    const pPos = patch.pos + dSeed * 2.0;
    const pOff = patch.offset + dSeed * 3.0;
    const cx = pPos * W;
    const cy = (0.5 + pOff * 0.32) * H;
    const rx = patch.len * W;
    const ry = patch.width * 0.26 * H;

    ctx.save();
    ctx.beginPath();
    const PTS = 48;
    for (let i = 0; i <= PTS; i++) {
      const th = (i / PTS) * TAU;
      const wobble =
        1.0 +
        Math.sin(th * 3.0 + patch.phase + pSeed) * 0.08 +
        Math.cos(th * 2.0 - patch.phase * 0.7 + pSeed) * 0.045;

      const px = cx + Math.cos(th) * rx * wobble;
      const py = cy + Math.sin(th) * ry * wobble;

      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();

    // Sashi Kiwa vector gradient
    const grad = ctx.createRadialGradient(cx, cy, rx * 0.2, cx, cy, rx);
    grad.addColorStop(0.0, HI_RED_GRAD);
    grad.addColorStop(0.85, HI_RED);
    grad.addColorStop(1.0, HI_RED);

    ctx.fillStyle = grad;
    ctx.shadowColor = "rgba(180, 30, 15, 0.25)";
    ctx.shadowBlur = 4;
    ctx.fill();
    ctx.restore();
  }

  // Special for Showa: Dark sumi base accents
  if (variety === "showa") {
    ctx.save();
    ctx.fillStyle = "rgba(22, 24, 20, 0.88)";
    // Head sumi
    ctx.beginPath();
    ctx.moveTo(0.05 * W, 0.5 * H);
    ctx.lineTo(0.18 * W, 0.42 * H);
    ctx.lineTo(0.15 * W, 0.5 * H);
    ctx.lineTo(0.18 * W, 0.58 * H);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // Second pass: Marking patches (Sumi Black) on top of Hi
  for (const patch of patches) {
    if (patch.kind !== "marking") continue;

    const pPos = patch.pos + dSeed * 2.0;
    const pOff = patch.offset + dSeed * 3.0;
    const cx = pPos * W;
    const cy = (0.5 + pOff * 0.32) * H;
    const rx = patch.len * W;
    const ry = patch.width * 0.26 * H;

    ctx.save();
    ctx.beginPath();
    const PTS = 48;
    for (let i = 0; i <= PTS; i++) {
      const th = (i / PTS) * TAU;
      const wobble =
        1.0 +
        Math.sin(th * 3.0 + patch.phase + pSeed) * 0.09 +
        Math.cos(th * 2.0 - patch.phase * 0.7 + pSeed) * 0.05;

      const px = cx + Math.cos(th) * rx * wobble;
      const py = cy + Math.sin(th) * ry * wobble;

      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();

    const grad = ctx.createRadialGradient(cx, cy, rx * 0.2, cx, cy, rx);
    grad.addColorStop(0.0, SUMI_BLACK);
    grad.addColorStop(0.85, SUMI_BLACK);
    grad.addColorStop(1.0, SUMI_BLACK_SOFT);

    ctx.fillStyle = grad;
    ctx.shadowColor = "rgba(10, 10, 10, 0.35)";
    ctx.shadowBlur = 3;
    ctx.fill();
    ctx.restore();
  }

  // 4. Tancho Head Disc (Crisp Vector Circle)
  if (variety === "tancho") {
    ctx.save();
    const cx = 0.155 * W;
    const cy = 0.5 * H;
    const r = 0.058 * W;

    const grad = ctx.createRadialGradient(cx, cy, r * 0.1, cx, cy, r);
    grad.addColorStop(0.0, "#f0442c");
    grad.addColorStop(0.8, "#d83018");
    grad.addColorStop(1.0, "#be2410");

    ctx.fillStyle = grad;
    ctx.shadowColor = "rgba(180, 20, 10, 0.3)";
    ctx.shadowBlur = 4;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  // 5. Delicate Gills and Facial Vector Contours
  ctx.strokeStyle = "rgba(90, 70, 60, 0.25)";
  ctx.lineWidth = 1.8;
  // Left gill
  ctx.beginPath();
  ctx.arc(0.23 * W, 0.34 * H, 18, -Math.PI * 0.3, Math.PI * 0.4);
  ctx.stroke();
  // Right gill
  ctx.beginPath();
  ctx.arc(0.23 * W, 0.66 * H, 18, -Math.PI * 0.4, Math.PI * 0.3);
  ctx.stroke();

  // Create High-Definition Texture
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;

  textureCache.set(cacheKey, texture);
  return texture;
}

const finTextureCache = new Map<string, THREE.CanvasTexture>();

/**
 * Generate a realistic translucent vector fin texture with alpha gradient & delicate ray striations
 */
export function getKoiFinTexture(variety: KoiVariety): THREE.CanvasTexture {
  const cacheKey = `fin_${variety}`;
  if (finTextureCache.has(cacheKey)) {
    return finTextureCache.get(cacheKey)!;
  }

  const W = 512;
  const H = 256;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    const fallback = new THREE.CanvasTexture(canvas);
    return fallback;
  }

  ctx.clearRect(0, 0, W, H);

  // 1. Base Horizontal Alpha Gradient (Root -> Translucent Tips)
  const grad = ctx.createLinearGradient(0, 0, W, 0);

  if (variety === "showa" || variety === "utsuri") {
    // Showa / Utsuri: Motoguro (inky sumi root fading to translucent smoky pearl)
    grad.addColorStop(0.0, "rgba(20, 22, 18, 0.94)");
    grad.addColorStop(0.18, "rgba(28, 30, 26, 0.84)");
    grad.addColorStop(0.42, "rgba(65, 70, 62, 0.58)");
    grad.addColorStop(0.72, "rgba(180, 180, 175, 0.32)");
    grad.addColorStop(0.90, "rgba(230, 230, 230, 0.14)");
    grad.addColorStop(1.0, "rgba(240, 240, 240, 0.02)");
  } else if (variety === "ogon") {
    // Yamabuki Ogon: Luminous golden amber fading to gossamer gold
    grad.addColorStop(0.0, "rgba(238, 168, 38, 0.92)");
    grad.addColorStop(0.18, "rgba(248, 188, 48, 0.82)");
    grad.addColorStop(0.42, "rgba(255, 215, 78, 0.55)");
    grad.addColorStop(0.72, "rgba(255, 235, 135, 0.30)");
    grad.addColorStop(0.90, "rgba(255, 248, 195, 0.14)");
    grad.addColorStop(1.0, "rgba(255, 252, 225, 0.02)");
  } else if (variety === "asagi") {
    // Asagi: Vermilion red base fading to soft peach pearl
    grad.addColorStop(0.0, "rgba(228, 65, 42, 0.92)");
    grad.addColorStop(0.18, "rgba(238, 92, 68, 0.82)");
    grad.addColorStop(0.42, "rgba(245, 145, 120, 0.52)");
    grad.addColorStop(0.72, "rgba(250, 195, 180, 0.28)");
    grad.addColorStop(0.90, "rgba(254, 230, 224, 0.12)");
    grad.addColorStop(1.0, "rgba(255, 248, 245, 0.02)");
  } else if (variety === "kohaku" || variety === "sanke") {
    // Kohaku & Sanke: Pearlescent ivory base with glowing apricot wash
    grad.addColorStop(0.0, "rgba(248, 242, 234, 0.92)");
    grad.addColorStop(0.18, "rgba(247, 215, 185, 0.82)");
    grad.addColorStop(0.42, "rgba(246, 145, 102, 0.52)");
    grad.addColorStop(0.72, "rgba(250, 195, 168, 0.28)");
    grad.addColorStop(0.90, "rgba(255, 235, 225, 0.12)");
    grad.addColorStop(1.0, "rgba(255, 248, 242, 0.02)");
  } else {
    // Tancho & Pure White: Ethereal crystalline membrane
    grad.addColorStop(0.0, "rgba(250, 246, 238, 0.92)");
    grad.addColorStop(0.18, "rgba(245, 246, 248, 0.82)");
    grad.addColorStop(0.42, "rgba(238, 242, 248, 0.50)");
    grad.addColorStop(0.72, "rgba(235, 242, 252, 0.28)");
    grad.addColorStop(0.90, "rgba(242, 246, 255, 0.12)");
    grad.addColorStop(1.0, "rgba(248, 250, 255, 0.02)");
  }

  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // 2. Vertical Soft Feathering at Edges
  const vGrad = ctx.createLinearGradient(0, 0, 0, H);
  vGrad.addColorStop(0.0, "rgba(255, 255, 255, 0.35)");
  vGrad.addColorStop(0.12, "rgba(255, 255, 255, 0.85)");
  vGrad.addColorStop(0.5, "rgba(255, 255, 255, 1.0)");
  vGrad.addColorStop(0.88, "rgba(255, 255, 255, 0.85)");
  vGrad.addColorStop(1.0, "rgba(255, 255, 255, 0.35)");
  ctx.globalCompositeOperation = "destination-in";
  ctx.fillStyle = vGrad;
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = "source-over";

  // 3. Delicate Fin Ray Striations (Tia vây / Gai vây)
  ctx.save();
  const numRays = 22;
  for (let i = 0; i < numRays; i++) {
    const frac = i / (numRays - 1);
    const y0 = frac * H;
    const spread = (frac - 0.5) * 24;
    const y1 = Math.max(4, Math.min(H - 4, frac * H + spread));

    // Delicate translucent white ray line
    ctx.strokeStyle = "rgba(255, 255, 255, 0.28)";
    ctx.lineWidth = i % 3 === 0 ? 1.8 : 1.1;
    ctx.beginPath();
    ctx.moveTo(0, y0);
    ctx.bezierCurveTo(W * 0.35, y0, W * 0.75, y1, W, y1);
    ctx.stroke();

    // Subtle dark groove line for depth
    ctx.strokeStyle = "rgba(0, 0, 0, 0.06)";
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(0, y0 + 1);
    ctx.bezierCurveTo(W * 0.35, y0 + 1, W * 0.75, y1 + 1, W, y1 + 1);
    ctx.stroke();
  }
  ctx.restore();

  // Create High-Definition Fin Texture
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;

  finTextureCache.set(cacheKey, texture);
  return texture;
}
