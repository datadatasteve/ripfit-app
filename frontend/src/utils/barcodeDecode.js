/**
 * Barcode decoding for the scanner (Phase 0B-1b).
 *
 * One entry point, decodeCanvas(canvas), used by both the live camera loop and
 * the photo fallback:
 *   1. The browser's own BarcodeDetector when it exists and supports the
 *      grocery formats (Chrome / Brave / Edge on Android, Safari 17+ on some
 *      devices). It is fast and handles blur and angle well.
 *   2. Otherwise ZXing (@zxing/library), loaded on first use only.
 *
 * Formats: EAN-13, EAN-8, UPC-A, UPC-E (what food packaging carries). Both
 * decoders verify the check digit before returning a code.
 */

const NATIVE_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];

let nativePromise = null;
let zxingPromise = null;

/** The native detector, or null when the browser lacks it or the formats. */
export function getNativeDetector() {
  if (nativePromise) return nativePromise;
  nativePromise = (async () => {
    try {
      if (typeof window === 'undefined' || !('BarcodeDetector' in window)) return null;
      const supported = await window.BarcodeDetector.getSupportedFormats?.();
      const formats = NATIVE_FORMATS.filter(f => !supported || supported.includes(f));
      if (formats.length === 0) return null;
      return new window.BarcodeDetector({ formats });
    } catch {
      return null;
    }
  })();
  return nativePromise;
}

/** Which decoder decodeCanvas will use: 'native' or 'zxing'. */
export async function decoderName() {
  return (await getNativeDetector()) ? 'native' : 'zxing';
}

function loadZxing() {
  if (!zxingPromise) {
    zxingPromise = import('@zxing/library').then(z => {
      const formats = [z.BarcodeFormat.EAN_13, z.BarcodeFormat.EAN_8, z.BarcodeFormat.UPC_A, z.BarcodeFormat.UPC_E];
      const make = (tryHarder) => {
        const hints = new Map();
        hints.set(z.DecodeHintType.POSSIBLE_FORMATS, formats);
        if (tryHarder) hints.set(z.DecodeHintType.TRY_HARDER, true);
        const reader = new z.MultiFormatReader();
        reader.setHints(hints);
        return reader;
      };
      return { z, fast: make(false), hard: make(true) };
    });
  }
  return zxingPromise;
}

/** Starts loading ZXing in the background (call when the scanner opens). */
export function preloadDecoders() {
  getNativeDetector().then(d => { if (!d) loadZxing(); });
}

async function decodeWithZxing(canvas, tryHarder) {
  const { z, fast, hard } = await loadZxing();
  const reader = tryHarder ? hard : fast;
  try {
    const source = new z.HTMLCanvasElementLuminanceSource(canvas);
    const bitmap = new z.BinaryBitmap(new z.HybridBinarizer(source));
    return reader.decode(bitmap).getText();
  } catch {
    return null;   // NotFound / checksum / format: nothing readable in this frame
  } finally {
    try { reader.reset(); } catch { /* stateless enough */ }
  }
}

/**
 * Reads one barcode from a canvas. Returns the digits, or null.
 * `tryHarder` (photos) makes ZXing search more thoroughly, at a CPU cost that
 * is fine for one still image but too slow for every video frame.
 */
export async function decodeCanvas(canvas, { tryHarder = false } = {}) {
  const native = await getNativeDetector();
  if (native) {
    try {
      const found = await native.detect(canvas);
      const hit = found.find(b => /^\d{6,14}$/.test(b.rawValue || ''));
      if (hit) return hit.rawValue;
      // On a still photo, let ZXing have a go too before giving up.
      if (!tryHarder) return null;
    } catch {
      /* fall through to ZXing */
    }
  }
  return decodeWithZxing(canvas, tryHarder);
}

/**
 * Decodes a photo file (the "Take a photo of the barcode" fallback). Tries the
 * whole picture, then the middle band, then the picture turned a quarter, so a
 * barcode photographed sideways or small still reads. Returns digits or null.
 */
export async function decodeImageFile(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Could not open that image'));
      el.src = url;
    });
    const w0 = img.naturalWidth, h0 = img.naturalHeight;
    if (!w0 || !h0) return null;
    // Large phone photos (12 MP+) are slow to scan; 1600 px on the long side
    // keeps a grocery barcode readable.
    const scale = Math.min(1, 1600 / Math.max(w0, h0));
    const w = Math.round(w0 * scale), h = Math.round(h0 * scale);

    const attempts = [
      { rotate: false, crop: null },
      { rotate: false, crop: { x: 0, y: 0.25, w: 1, h: 0.5 } },
      { rotate: true, crop: null },
      { rotate: true, crop: { x: 0, y: 0.25, w: 1, h: 0.5 } },
    ];
    for (const a of attempts) {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const cw = a.rotate ? h : w, ch = a.rotate ? w : h;
      canvas.width = cw; canvas.height = ch;
      if (a.rotate) { ctx.translate(cw, 0); ctx.rotate(Math.PI / 2); }
      ctx.drawImage(img, 0, 0, w, h);
      let target = canvas;
      if (a.crop) {
        const c2 = document.createElement('canvas');
        c2.width = Math.round(cw * a.crop.w); c2.height = Math.round(ch * a.crop.h);
        c2.getContext('2d', { willReadFrequently: true })
          .drawImage(canvas, cw * a.crop.x, ch * a.crop.y, c2.width, c2.height, 0, 0, c2.width, c2.height);
        target = c2;
      }
      const code = await decodeCanvas(target, { tryHarder: true });
      if (code) return code;
    }
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}
