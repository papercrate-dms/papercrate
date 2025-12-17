import { HEX_COLOR_PATTERN } from '../constants/colors';

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const clampRange = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const hslToHex = (h: number, s: number, l: number): string => {
  const normalizedH = ((h % 360) + 360) % 360;
  const sat = clamp01(s);
  const light = clamp01(l);

  const chroma = (1 - Math.abs(2 * light - 1)) * sat;
  const hPrime = normalizedH / 60;
  const x = chroma * (1 - Math.abs((hPrime % 2) - 1));

  let r1 = 0;
  let g1 = 0;
  let b1 = 0;

  if (hPrime >= 0 && hPrime < 1) {
    r1 = chroma;
    g1 = x;
  } else if (hPrime >= 1 && hPrime < 2) {
    r1 = x;
    g1 = chroma;
  } else if (hPrime >= 2 && hPrime < 3) {
    g1 = chroma;
    b1 = x;
  } else if (hPrime >= 3 && hPrime < 4) {
    g1 = x;
    b1 = chroma;
  } else if (hPrime >= 4 && hPrime < 5) {
    r1 = x;
    b1 = chroma;
  } else {
    r1 = chroma;
    b1 = x;
  }

  const m = light - chroma / 2;
  const r = clamp01(r1 + m);
  const g = clamp01(g1 + m);
  const b = clamp01(b1 + m);

  const sr = Math.round(r * 255);
  const sg = Math.round(g * 255);
  const sb = Math.round(b * 255);
  return `#${((sr << 16) | (sg << 8) | sb).toString(16).padStart(6, '0')}`;
};

interface RgbColor {
  r: number;
  g: number;
  b: number;
}

const rgbToHsl = ({ r, g, b }: RgbColor) => {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;

  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;

  let hue = 0;
  if (delta !== 0) {
    if (max === rn) {
      hue = ((gn - bn) / delta) % 6;
    } else if (max === gn) {
      hue = (bn - rn) / delta + 2;
    } else {
      hue = (rn - gn) / delta + 4;
    }
    hue *= 60;
    if (hue < 0) hue += 360;
  }

  const lightness = (max + min) / 2;
  let saturation = 0;
  if (delta !== 0) {
    saturation = delta / (1 - Math.abs(2 * lightness - 1));
  }

  return { h: hue, s: clamp01(saturation), l: clamp01(lightness) };
};

const srgbChannelToLinear = (value: number) => {
  const normalized = value / 255;
  if (normalized <= 0.04045) {
    return normalized / 12.92;
  }
  return ((normalized + 0.055) / 1.055) ** 2.4;
};

const hexToRgb = (input?: string): (RgbColor & { hex: string }) | null => {
  if (!input) return null;
  const match = HEX_COLOR_PATTERN.exec(input.trim());
  if (!match) return null;
  const value = parseInt(match[1], 16);
  return {
    r: (value >> 16) & 0xff,
    g: (value >> 8) & 0xff,
    b: value & 0xff,
    hex: `#${match[1].toLowerCase()}`,
  };
};

const hexToOklch = (input?: string) => {
  const rgb = hexToRgb(input);
  if (!rgb) {
    return null;
  }
  const r = srgbChannelToLinear(rgb.r);
  const g = srgbChannelToLinear(rgb.g);
  const b = srgbChannelToLinear(rgb.b);

  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;

  const lRoot = Math.cbrt(l);
  const mRoot = Math.cbrt(m);
  const sRoot = Math.cbrt(s);

  const L = 0.2104542553 * lRoot + 0.793617785 * mRoot - 0.0040720468 * sRoot;
  const a = 1.9779984951 * lRoot - 2.428592205 * mRoot + 0.4505937099 * sRoot;
  const bLab = 0.0259040371 * lRoot + 0.7827717662 * mRoot - 0.808675766 * sRoot;

  const chroma = Math.sqrt(a * a + bLab * bLab);
  let hue = Math.atan2(bLab, a) * (180 / Math.PI);
  if (hue < 0) {
    hue += 360;
  }

  return {
    l: clamp01(L),
    c: chroma,
    h: hue,
  };
};

const formatCssNumber = (value: number) => {
  if (!Number.isFinite(value)) {
    return `${value}`;
  }
  const rounded = Number(value.toFixed(6));
  return `${rounded}`;
};

const buildTagStyle = (backgroundHex: string) => {
  const oklch = hexToOklch(backgroundHex);
  if (!oklch) {
    return {
      '--tag-chip-base': backgroundHex,
    };
  }
  return {
    '--tag-chip-base': backgroundHex,
    '--tag-chip-base-l': formatCssNumber(oklch.l),
    '--tag-chip-base-c': formatCssNumber(oklch.c),
    '--tag-chip-base-h': formatCssNumber(oklch.h),
  };
};

const relativeLuminance = ({ r, g, b }: RgbColor): number => {
  const toLinear = (channel) => {
    const normalized = channel / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  };

  const [red, green, blue] = [toLinear(r), toLinear(g), toLinear(b)];
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
};

const contrastRatio = (lumA: number, lumB: number): number => {
  const [lighter, darker] = lumA >= lumB ? [lumA, lumB] : [lumB, lumA];
  return (lighter + 0.05) / (darker + 0.05);
};

const parseCandidateColor = (candidate: string) => {
  const rgb = hexToRgb(candidate);
  if (!rgb) return null;
  return {
    hex: rgb.hex,
    luminance: relativeLuminance(rgb),
  };
};

const contrastForPair = (backgroundHex: string, textHex: string): number => {
  const background = hexToRgb(backgroundHex);
  const text = hexToRgb(textHex);
  if (!background || !text) {
    return 0;
  }
  return contrastRatio(relativeLuminance(background), relativeLuminance(text));
};

const getReadableTextColor = (
  hex: string,
  { light = '#1f1f1f', dark = '#ffffff', fallback = '#1f1f1f' }: { light?: string; dark?: string; fallback?: string } = {},
): string => {
  const background = hexToRgb(hex);
  if (!background) return fallback;

  const backgroundLuminance = relativeLuminance(background);
  const backgroundHsl = rgbToHsl(background);

  const hueShift = 180;
  const textHue = (backgroundHsl.h + hueShift) % 360;
  const targetSaturation = clampRange(backgroundHsl.s * 1.15, 0.4, 0.85);
  const minLightness = 0.05;
  const maxLightness = 0.95;
  const sampleCount = 24;

  const buildCandidate = (lightness) => {
    const light = clampRange(lightness, minLightness, maxLightness);
    const hexValue = hslToHex(textHue, targetSaturation, light);
    return parseCandidateColor(hexValue);
  };

  const candidates = new Map();

  for (let index = 0; index < sampleCount; index += 1) {
    const t = index / (sampleCount - 1);
    const candidateLightness = minLightness + t * (maxLightness - minLightness);
    const candidate = buildCandidate(candidateLightness);
    if (candidate) {
      candidates.set(candidate.hex, candidate);
    }
  }

  [light, dark].forEach((preset) => {
    const parsed = parseCandidateColor(preset);
    if (parsed) {
      candidates.set(parsed.hex, parsed);
    }
  });

  if (candidates.size === 0) {
    return fallback;
  }

  let best = null;
  let bestRatio = -Infinity;
  candidates.forEach((candidate) => {
    const ratio = contrastRatio(backgroundLuminance, candidate.luminance);
    if (ratio > bestRatio) {
      bestRatio = ratio;
      best = candidate;
    }
  });

  const MIN_CONTRAST = 4.5;
  if (bestRatio < MIN_CONTRAST) {
    const extremeLight = buildCandidate(maxLightness);
    const extremeDark = buildCandidate(minLightness);
    const extremes = [extremeLight, extremeDark].filter(Boolean);
    extremes.forEach((candidate) => {
      const ratio = contrastRatio(backgroundLuminance, candidate.luminance);
      if (ratio > bestRatio) {
        bestRatio = ratio;
        best = candidate;
      }
    });
  }

  return best?.hex || fallback;
};

export const getTagColorStyle = (hex) => {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const baseHex = rgb.hex;
  const baseHsl = rgbToHsl(rgb);
  const baseText = getReadableTextColor(baseHex);
  const baseRatio = contrastForPair(baseHex, baseText);
  const TARGET_RATIO = 8;
  const MIN_LIGHTNESS = 0.12;
  const MAX_LIGHTNESS = 0.88;
  const adjustments = [-0.18, -0.12, -0.08, -0.04, 0.04, 0.08, 0.12, 0.18];
  const seen = new Map();

  const registerCandidate = (lightness) => {
    const clamped = clampRange(lightness, MIN_LIGHTNESS, MAX_LIGHTNESS);
    const hexValue = hslToHex(baseHsl.h, baseHsl.s, clamped);
    if (!seen.has(hexValue)) {
      seen.set(hexValue, clamped);
    }
  };

  registerCandidate(baseHsl.l);
  adjustments.forEach((delta) => registerCandidate(baseHsl.l + delta));

  let bestBackground = baseHex;
  let bestRatio = baseRatio;

  if (bestRatio >= TARGET_RATIO) {
    return buildTagStyle(bestBackground);
  }

  let compliantBackground = null;
  let compliantDelta = Infinity;
  let compliantRatio = -Infinity;

  seen.forEach((lightness, candidateHex) => {
    const textHex = getReadableTextColor(candidateHex);
    const ratio = contrastForPair(candidateHex, textHex);
    const delta = Math.abs(lightness - baseHsl.l);

    if (ratio > bestRatio) {
      bestBackground = candidateHex;
      bestRatio = ratio;
    }

    if (ratio >= TARGET_RATIO) {
      const deltaEpsilon = 0.0025;
      const ratioEpsilon = 0.01;
      const isCloser = delta + deltaEpsilon < compliantDelta;
      const isSimilarDistance = Math.abs(delta - compliantDelta) <= deltaEpsilon;
      const improvesRatio = ratio > compliantRatio + ratioEpsilon;
      if (
        compliantBackground === null
        || isCloser
        || (isSimilarDistance && improvesRatio)
      ) {
        compliantBackground = candidateHex;
        compliantDelta = delta;
        compliantRatio = ratio;
      }
    }
  });

  if (compliantBackground) {
    return buildTagStyle(compliantBackground);
  }

  return buildTagStyle(bestBackground);
};

export const generateRandomTagColor = () => {
  const bucketCount = 8;
  const bucketWidth = 360 / bucketCount;
  const bucket = Math.floor(Math.random() * bucketCount);
  const baseHue = bucket * bucketWidth;
  const hueJitter = bucketWidth * 0.35;
  const hue = baseHue + (Math.random() * 2 - 1) * hueJitter;
  const saturation = 0.45 + Math.random() * 0.2; // 0.45 - 0.65
  const lightness = 0.55 + Math.random() * 0.1; // 0.55 - 0.65
  return hslToHex(hue, saturation, lightness);
};

export { HEX_COLOR_PATTERN };
