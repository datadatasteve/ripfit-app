import { useState, useEffect, useRef, useCallback } from 'react';
import { decodeCanvas, decodeImageFile, decoderName, preloadDecoders } from '../utils/barcodeDecode';
import './BarcodeScanner.css';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';
const token = () => localStorage.getItem('ripfit_token');
const round1 = n => Math.round((Number(n) || 0) * 10) / 10;

// Same conversions the meal endpoint uses; unknown units count as grams there too.
const UNIT_TO_G = { g: 1, ml: 1, oz: 28.3495, lb: 453.592, kg: 1000 };

const MEALS = [
  ['breakfast', 'Breakfast'], ['lunch', 'Lunch'], ['dinner', 'Dinner'], ['snacks', 'Snacks'],
];

const stripZeros = code => String(code || '').replace(/^0+/, '');

// ── Camera choice ────────────────────────────────────────────────────────
const CAMERA_KEY = 'ripfit_scanner_camera';
const SLOW_HINT_MS = 8000;
const SCAN_GAP_MS = 120;
// The aiming box, as fractions of the camera view (3:4 portrait). The CSS
// uses the same numbers; the decoder reads this area plus a margin.
const BOX = { w: 0.84, h: 0.4 };
const BOX_MARGIN = 0.08;
// Start zoom: with a barcode 15 to 20 cm from a phone's main camera, about
// 2x makes it fill most of the box (where phones can still focus).
const START_ZOOM = 2;
const DIGITAL_ZOOM_MAX = 3;

function loadSavedCamera() {
  try { return JSON.parse(localStorage.getItem(CAMERA_KEY) || 'null'); } catch { return null; }
}
function saveCamera(cam) {
  try { localStorage.setItem(CAMERA_KEY, JSON.stringify({ deviceId: cam.deviceId, label: cam.label })); } catch { /* not kept */ }
}

const isBackLabel = l => /back|rear|environment|world/i.test(l || '');
const isFrontLabel = l => /front|user|face ?time|selfie/i.test(l || '');

/**
 * How suitable a camera is for close-up barcodes, from its label. Phones name
 * their lenses: iOS "Back Camera" (main) / "Back Ultra Wide Camera" /
 * "Back Telephoto Camera"; Android "camera2 0, facing back", where id 0 is the
 * primary back camera by Android convention. Ultra-wide and telephoto lenses
 * focus poorly up close, so they rank last.
 */
function cameraScore(label) {
  const l = (label || '').toLowerCase();
  if (/ultra|ultrawide|uw\b|0\.5x|wide[- ]angle/.test(l)) return -2;
  if (/tele|zoom|macro/.test(l)) return -1;
  if (/^back camera$|camera2 0\b|camera 0\b|main/.test(l)) return 3;
  if (/dual|triple/.test(l)) return 1;
  return isBackLabel(l) ? 2 : 0;
}

/** The back cameras (all cameras when the labels say nothing), best first. */
function rankCameras(devices) {
  const video = devices.filter(d => d.kind === 'videoinput');
  const back = video.filter(d => isBackLabel(d.label));
  const pool = back.length ? back : video.filter(d => !isFrontLabel(d.label));
  const list = (pool.length ? pool : video).map(d => ({ deviceId: d.deviceId, label: d.label || 'Camera' }));
  return list.sort((a, b) => cameraScore(b.label) - cameraScore(a.label));
}

function shortLabel(label) {
  const l = label || 'Camera';
  const m = l.match(/camera2 (\d+)/i);
  if (m) return m[1] === '0' ? 'Main camera' : `Camera ${m[1]}`;
  return l.replace(/\s*\(.*\)$/, '');
}

/**
 * Barcode scanner (Patch 001; rebuilt in Phase 0B-1b).
 *
 * A ladder, so something always works:
 *   1. Live camera: the main back camera at 1080p when available (Switch
 *      camera cycles the back cameras and is remembered), continuous focus,
 *      a zoom slider (the lens's own zoom, or a digital zoom), tap to focus.
 *   2. Reading is automatic: every ~0.1 s the box area is decoded with the
 *      browser's BarcodeDetector, or ZXing where there is none.
 *   3. Take a photo of the barcode: the phone's own camera app (which focuses
 *      properly), decoded the same way.
 *   4. Type the number.
 * Then the existing lookup (POST /nutrition/foods/barcode/:code) and the food
 * card.
 *
 * mode 'meal' (inside a meal's "+ Add"): the card logs to that meal, as before.
 * mode 'check' (Nutrition landing Scan): the card offers Add to meal (choose
 * the meal, then it logs the same way) or Just checking (nothing logged).
 */
export default function BarcodeScanner({
  mode = 'meal', mealType, mealDate, mealLabel, dateLabel,
  onClose, onLogged, onManualSearch,
}) {
  // 'starting' | 'scanning' | 'paused' | 'reading-photo' | 'looking-up' | 'result'
  // | 'not-found' | 'denied' | 'unavailable' | 'busy-camera' | 'error'
  const [phase, setPhase] = useState('starting');
  const [message, setMessage] = useState('');
  const [scanned, setScanned] = useState('');
  const [food, setFood] = useState(null);
  const [quantity, setQuantity] = useState('1');
  const [logging, setLogging] = useState(false);
  const [logError, setLogError] = useState('');
  const [choosingMeal, setChoosingMeal] = useState(false);

  const [cameras, setCameras] = useState([]);
  const [cameraId, setCameraId] = useState(null);
  const [zoom, setZoom] = useState(null);           // { min, max, step, value, hardware }
  const [canTapFocus, setCanTapFocus] = useState(false);
  const [focusMark, setFocusMark] = useState(null); // { x, y } in % while focusing
  const [slowHint, setSlowHint] = useState(false);
  const [typed, setTyped] = useState('');
  const [typedError, setTypedError] = useState('');
  const [photoError, setPhotoError] = useState('');
  const [decoder, setDecoder] = useState('');

  const videoRef = useRef(null);
  const boxRef = useRef(null);
  const fileRef = useRef(null);
  const streamRef = useRef(null);
  const loopRef = useRef(null);
  const hintRef = useRef(null);
  const focusTimerRef = useRef(null);
  const zoomRef = useRef(null);
  const aliveRef = useRef(true);
  const scanningRef = useRef(false);
  const canvasRef = useRef(null);

  zoomRef.current = zoom;

  // ── Camera plumbing ──
  const stopLoop = () => {
    scanningRef.current = false;
    clearTimeout(loopRef.current);
    clearTimeout(hintRef.current);
  };

  const stopCamera = useCallback(() => {
    stopLoop();
    clearTimeout(focusTimerRef.current);
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const track = () => streamRef.current?.getVideoTracks?.()[0] || null;

  /** The decode area (the box plus a margin) in video pixels. */
  const cropRect = () => {
    const video = videoRef.current, box = boxRef.current;
    if (!video || !box || !video.videoWidth) return null;
    const vw = video.videoWidth, vh = video.videoHeight;
    const cw = box.clientWidth, ch = box.clientHeight;
    const z = zoomRef.current && !zoomRef.current.hardware ? zoomRef.current.value : 1;
    const s = Math.max(cw / vw, ch / vh) * z;           // object-fit: cover, then digital zoom
    const ox = (cw - vw * s) / 2, oy = (ch - vh * s) / 2;
    const fw = Math.min(1, BOX.w + BOX_MARGIN * 2), fh = Math.min(1, BOX.h + BOX_MARGIN * 2);
    const x0 = ((1 - fw) / 2) * cw, y0 = ((1 - fh) / 2) * ch;
    const x = Math.max(0, (x0 - ox) / s), y = Math.max(0, (y0 - oy) / s);
    const w = Math.min(vw - x, (fw * cw) / s), h = Math.min(vh - y, (fh * ch) / s);
    return w > 8 && h > 8 ? { x, y, w, h } : null;
  };

  const lookUp = useCallback(async (code) => {
    stopCamera();
    setScanned(code);
    setPhase('looking-up');
    try {
      const res = await fetch(`${API_BASE}/nutrition/foods/barcode/${encodeURIComponent(code)}`, { method: 'POST' });
      if (!aliveRef.current) return;
      if (res.status === 404) { setPhase('not-found'); return; }
      if (!res.ok) throw new Error('Lookup failed');
      const data = await res.json();
      if (!aliveRef.current) return;
      if (!data.food) { setPhase('not-found'); return; }
      setFood(data.food);
      setQuantity('1');
      setChoosingMeal(false);
      setPhase('result');
    } catch {
      if (!aliveRef.current) return;
      setMessage('The barcode lookup failed. Check your connection and try again.');
      setPhase('error');
    }
  }, [stopCamera]);

  const scanFrame = async () => {
    if (!scanningRef.current) return;
    const video = videoRef.current;
    const r = cropRect();
    if (video && r && video.readyState >= 2) {
      const canvas = canvasRef.current || (canvasRef.current = document.createElement('canvas'));
      const scale = Math.min(1, 1000 / r.w);
      canvas.width = Math.round(r.w * scale);
      canvas.height = Math.round(r.h * scale);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(video, r.x, r.y, r.w, r.h, 0, 0, canvas.width, canvas.height);
      let code = null;
      try { code = await decodeCanvas(canvas); } catch { code = null; }
      if (!scanningRef.current) return;
      if (code) { lookUp(code); return; }
    }
    loopRef.current = setTimeout(scanFrame, SCAN_GAP_MS);
  };

  const startLoop = () => {
    stopLoop();
    scanningRef.current = true;
    setSlowHint(false);
    hintRef.current = setTimeout(() => { if (aliveRef.current) setSlowHint(true); }, SLOW_HINT_MS);
    loopRef.current = setTimeout(scanFrame, 300);
  };

  /** Focus and zoom from what this camera says it can do. */
  const setUpTrack = async (t) => {
    const caps = t?.getCapabilities?.() || {};
    const focusModes = caps.focusMode || [];
    if (focusModes.includes('continuous')) {
      try { await t.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }); } catch { /* keep default */ }
    }
    setCanTapFocus(!!(caps.pointsOfInterest || focusModes.includes('single-shot') || focusModes.includes('manual')));

    if (caps.zoom && caps.zoom.max > caps.zoom.min) {
      const { min, max } = caps.zoom;
      const step = caps.zoom.step || 0.1;
      const value = Math.min(max, Math.max(min, START_ZOOM));
      try { await t.applyConstraints({ advanced: [{ zoom: value }] }); } catch { /* stays at 1x */ }
      setZoom({ min, max, step, value, hardware: true });
    } else {
      // No lens zoom: a digital zoom of the preview, and the decoder reads the
      // same enlarged area. 1080p video has the detail to spare.
      const w = t?.getSettings?.().width || 0;
      setZoom({ min: 1, max: DIGITAL_ZOOM_MAX, step: 0.1, value: w >= 1280 ? 1.5 : 1, hardware: false });
    }
  };

  const openStream = async (deviceId) => {
    const size = { width: { ideal: 1920 }, height: { ideal: 1080 } };
    const video = deviceId
      ? { deviceId: { exact: deviceId }, ...size }
      : { facingMode: { ideal: 'environment' }, ...size };
    return navigator.mediaDevices.getUserMedia({ video, audio: false });
  };

  /** Opens a camera (the given one, else the saved one, else the best back camera). */
  const startCamera = useCallback(async (wantedId = null) => {
    stopCamera();
    setPhase('starting');
    setPhotoError('');
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setMessage(!window.isSecureContext
        ? 'The camera only works on a secure (https) page.'
        : 'This browser cannot use a camera here.');
      setPhase('unavailable');
      return;
    }
    const saved = loadSavedCamera();
    let stream = null;
    try {
      const firstTry = wantedId || saved?.deviceId || null;
      try {
        stream = await openStream(firstTry);
      } catch (err) {
        if (!firstTry || err?.name === 'NotAllowedError' || err?.name === 'SecurityError') throw err;
        stream = await openStream(null);   // the saved camera is gone: fall back
      }
      if (!aliveRef.current) { stream.getTracks().forEach(t => t.stop()); return; }

      // Labels and ids are only listed once permission is granted.
      let list = [];
      try { list = rankCameras(await navigator.mediaDevices.enumerateDevices()); } catch { /* single camera */ }
      let t = stream.getVideoTracks()[0];
      let currentId = t?.getSettings?.().deviceId || null;
      const currentLabel = t?.label || '';

      // First time (nothing chosen yet): if the browser's pick looks like an
      // ultra-wide / telephoto lens or a secondary camera, open the best one.
      if (!wantedId && !saved && list.length > 1) {
        const best = list[0];
        if (best.deviceId && best.deviceId !== currentId && cameraScore(best.label) > cameraScore(currentLabel)) {
          try {
            stream.getTracks().forEach(tr => tr.stop());
            stream = await openStream(best.deviceId);
            t = stream.getVideoTracks()[0];
            currentId = t?.getSettings?.().deviceId || best.deviceId;
          } catch {
            stream = await openStream(null);
            t = stream.getVideoTracks()[0];
            currentId = t?.getSettings?.().deviceId || null;
          }
        }
      }
      if (!aliveRef.current) { stream.getTracks().forEach(tr => tr.stop()); return; }

      // A saved id may have changed (some browsers rotate them): match by label.
      if (!list.some(c => c.deviceId === currentId) && t?.label) {
        const byLabel = list.find(c => c.label === t.label);
        if (byLabel) currentId = byLabel.deviceId;
      }
      if (!list.some(c => c.deviceId === currentId) && currentId) {
        list = [{ deviceId: currentId, label: t?.label || 'Camera' }, ...list];
      }

      streamRef.current = stream;
      setCameras(list);
      setCameraId(currentId);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        try { await videoRef.current.play(); } catch { /* autoplay attr covers it */ }
      }
      await setUpTrack(t);
      if (!aliveRef.current) return;
      setPhase('scanning');
      startLoop();
    } catch (err) {
      stream?.getTracks().forEach(tr => tr.stop());
      if (!aliveRef.current) return;
      const name = err?.name;
      if (name === 'NotAllowedError' || name === 'SecurityError') setPhase('denied');
      else if (name === 'NotReadableError' || name === 'AbortError') setPhase('busy-camera');
      else {
        setMessage('No camera was found on this device.');
        setPhase('unavailable');
      }
    }
  }, [stopCamera, lookUp]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    aliveRef.current = true;
    preloadDecoders();
    decoderName().then(n => { if (aliveRef.current) setDecoder(n); });
    startCamera();
    return () => { aliveRef.current = false; stopCamera(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const switchCamera = () => {
    if (cameras.length < 2) return;
    const i = cameras.findIndex(c => c.deviceId === cameraId);
    const next = cameras[(i + 1) % cameras.length];
    saveCamera(next);
    startCamera(next.deviceId);
  };

  const changeZoom = async (value) => {
    const z = zoomRef.current;
    if (!z) return;
    const v = Math.min(z.max, Math.max(z.min, Number(value)));
    setZoom({ ...z, value: v });
    if (z.hardware) {
      try { await track()?.applyConstraints({ advanced: [{ zoom: v }] }); } catch { /* ignore */ }
    }
  };

  const tapFocus = async (e) => {
    if (!canTapFocus || phase !== 'scanning') return;
    const t = track();
    const rect = e.currentTarget.getBoundingClientRect();
    const fx = (e.clientX - rect.left) / rect.width;
    const fy = (e.clientY - rect.top) / rect.height;
    setFocusMark({ x: fx * 100, y: fy * 100 });
    clearTimeout(focusTimerRef.current);
    const caps = t?.getCapabilities?.() || {};
    const modes = caps.focusMode || [];
    try {
      await t?.applyConstraints({ advanced: [{
        ...(caps.pointsOfInterest ? { pointsOfInterest: [{ x: fx, y: fy }] } : {}),
        ...(modes.includes('single-shot') ? { focusMode: 'single-shot' } : {}),
      }] });
    } catch { /* not supported after all */ }
    focusTimerRef.current = setTimeout(async () => {
      setFocusMark(null);
      if (modes.includes('continuous')) {
        try { await track()?.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }); } catch { /* ignore */ }
      }
    }, 1500);
  };

  // ── Photo fallback ──
  const takePhoto = () => {
    // Free the camera first: on Android the phone's camera app can't open
    // while this page still holds it.
    stopCamera();
    setPhotoError('');
    setPhase('paused');
    if (fileRef.current) { fileRef.current.value = ''; fileRef.current.click(); }
  };

  const onPhoto = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhase('reading-photo');
    let code = null;
    try { code = await decodeImageFile(file); } catch { code = null; }
    if (!aliveRef.current) return;
    if (code) { lookUp(code); return; }
    setPhotoError('No barcode could be read in that photo. Take it again with the barcode flat, filling most of the picture and sharp, or type the number.');
    setPhase('paused');
  };

  // ── Typed code ──
  const submitTyped = (e) => {
    e?.preventDefault?.();
    const digits = typed.replace(/\D/g, '');
    if (digits.length < 6 || digits.length > 14) {
      setTypedError('Type all the digits printed under the barcode (usually 12 or 13).');
      return;
    }
    setTypedError('');
    lookUp(digits);
  };

  const close = () => { stopCamera(); onClose(); };
  const manual = onManualSearch ? () => { stopCamera(); onManualSearch(); } : null;

  // ── Result maths: servings of the food's own serving size ──
  const servingSize = Number(food?.serving_size) || 0;
  const servingUnit = food?.serving_unit || '';
  const hasServing = servingSize > 0 && !!servingUnit;
  const qty = parseFloat(quantity);
  const qtyValid = Number.isFinite(qty) && qty > 0;
  // Without serving data each unit counts as 100 g, the basis of the per-100g values.
  const totalAmount = qtyValid ? qty * (hasServing ? servingSize : 100) : 0;
  const totalUnit = hasServing ? servingUnit : 'g';
  const mult = (totalAmount * (UNIT_TO_G[totalUnit.toLowerCase()] || 1)) / 100;
  const macro = key => (food?.[key] == null ? null : round1(Number(food[key]) * mult));
  const macros = food ? {
    cal: macro('calories_per_100g'),
    protein: macro('protein_per_100g'),
    carbs: macro('carbs_per_100g'),
    fat: macro('fat_per_100g'),
  } : null;
  const suspicious = food?.gtin_upc && scanned && stripZeros(food.gtin_upc) !== stripZeros(scanned);

  /** Logs the food exactly as the meal modal does (POST /nutrition/meals). */
  const logFood = async (meal) => {
    if (!qtyValid) return;
    setLogging(true);
    setLogError('');
    try {
      const res = await fetch(`${API_BASE}/nutrition/meals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({
          meal_date: mealDate,
          meal_type: meal,
          foods: [{ food_id: food.id, serving_size: totalAmount, serving_unit: totalUnit }],
        }),
      });
      if (!res.ok) throw new Error();
      onLogged(meal, food);
    } catch {
      setLogError('Could not log this food. Try again.');
      setLogging(false);
    }
  };

  const scanAgain = () => { setFood(null); setScanned(''); setTyped(''); startCamera(cameraId); };

  // ── Pieces ──
  const typeRow = (
    <form className="bcs-type-row" onSubmit={submitTyped}>
      <label htmlFor="bcs-typed" className="bcs-type-label">Or type the barcode number</label>
      <div className="bcs-type-inputs">
        <input
          id="bcs-typed"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder="e.g. 016000275287"
          value={typed}
          onChange={e => { setTyped(e.target.value.replace(/[^\d\s]/g, '')); setTypedError(''); }}
        />
        <button type="submit" className="bcs-primary bcs-type-btn" disabled={!typed.trim()}>Look up</button>
      </div>
      {typedError && <p className="bcs-error">{typedError}</p>}
    </form>
  );

  const photoButton = (
    <button type="button" className="bcs-secondary" onClick={takePhoto}>
      📷 Take a photo of the barcode
    </button>
  );

  const fallback = (title, body, { retry = false } = {}) => (
    <div className="bcs-panel">
      <h4 className="bcs-title">{title}</h4>
      <p className="bcs-text">{body}</p>
      <div className="bcs-actions">
        {retry && <button type="button" className="bcs-primary" onClick={() => startCamera(cameraId)}>Try the camera again</button>}
        {photoButton}
      </div>
      {typeRow}
      <div className="bcs-actions">
        {manual && <button type="button" className="bcs-secondary" onClick={manual}>Search by name</button>}
        <button type="button" className="bcs-secondary" onClick={close}>Close</button>
      </div>
    </div>
  );

  const liveCamera = phase === 'starting' || phase === 'scanning';
  const current = cameras.find(c => c.deviceId === cameraId);

  return (
    <div className="bcs-overlay" role="dialog" aria-modal="true" aria-label="Scan barcode">
      <div className="bcs-sheet">
        <div className="bcs-header">
          <h3>Scan barcode{mode === 'meal' && mealLabel ? ` · ${mealLabel}` : ''}</h3>
          <button data-tooltip="Close scanner" type="button" className="bcs-close" onClick={close} aria-label="Close scanner">✕</button>
        </div>

        {/* Photo input lives outside the phases so it survives them. */}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="bcs-file"
          onChange={onPhoto}
          tabIndex={-1}
          aria-hidden="true"
        />

        {liveCamera && (
          <div className="bcs-camera-wrap">
            <div
              ref={boxRef}
              className={`bcs-camera ${canTapFocus ? 'can-focus' : ''}`}
              onClick={tapFocus}
            >
              <video
                ref={videoRef}
                className="bcs-video"
                style={zoom && !zoom.hardware && zoom.value !== 1 ? { transform: `scale(${zoom.value})` } : undefined}
                playsInline
                muted
                autoPlay
              />
              <div className="bcs-reticle" aria-hidden="true"><span /></div>
              {focusMark && (
                <span className="bcs-focus-mark" style={{ left: `${focusMark.x}%`, top: `${focusMark.y}%` }} aria-hidden="true" />
              )}
              {phase === 'starting' && <div className="bcs-camera-status">Starting camera…</div>}
            </div>

            <p className="bcs-instruction" role="status" aria-live="polite">
              {phase === 'starting'
                ? 'Starting camera…'
                : slowHint
                  ? 'Move closer or farther, or tap Switch camera.'
                  : 'Hold the barcode inside the box. It scans by itself.'}
            </p>
            {phase === 'scanning' && canTapFocus && !slowHint && (
              <p className="bcs-subhint">Blurry? Tap the picture to focus.</p>
            )}

            {zoom && phase === 'scanning' && (
              <div className="bcs-zoom">
                <button type="button" className="bcs-zoom-btn" aria-label="Zoom out" data-tooltip="Zoom out"
                  onClick={() => changeZoom(zoom.value - Math.max(zoom.step, 0.5))} disabled={zoom.value <= zoom.min}>−</button>
                <input
                  type="range"
                  min={zoom.min}
                  max={zoom.max}
                  step={zoom.step}
                  value={zoom.value}
                  onChange={e => changeZoom(e.target.value)}
                  aria-label="Zoom"
                />
                <button type="button" className="bcs-zoom-btn" aria-label="Zoom in" data-tooltip="Zoom in"
                  onClick={() => changeZoom(zoom.value + Math.max(zoom.step, 0.5))} disabled={zoom.value >= zoom.max}>+</button>
                <span className="bcs-zoom-value">{round1(zoom.value)}×</span>
              </div>
            )}

            <div className="bcs-tools">
              {cameras.length > 1 && (
                <button type="button" className="bcs-secondary" onClick={switchCamera} disabled={phase !== 'scanning'}>
                  ⇄ Switch camera
                </button>
              )}
              {photoButton}
            </div>
            {cameras.length > 1 && current && (
              <p className="bcs-camera-name">Using: {shortLabel(current.label)} ({cameras.findIndex(c => c.deviceId === cameraId) + 1} of {cameras.length})</p>
            )}
            {typeRow}
            {manual && (
              <button type="button" className="bcs-secondary bcs-manual-link" onClick={manual}>Search by name instead</button>
            )}
            {decoder && <p className="bcs-decoder" data-decoder={decoder}>{decoder === 'native' ? 'Reader: built-in' : 'Reader: ZXing'}</p>}
          </div>
        )}

        {phase === 'paused' && (
          <div className="bcs-panel">
            {photoError
              ? <p className="bcs-error">{photoError}</p>
              : <p className="bcs-text">Take a photo of the barcode with your camera, or go back to the live camera.</p>}
            <div className="bcs-actions">
              {photoButton}
              <button type="button" className="bcs-primary" onClick={() => startCamera(cameraId)}>Use the live camera</button>
            </div>
            {typeRow}
            <div className="bcs-actions">
              {manual && <button type="button" className="bcs-secondary" onClick={manual}>Search by name</button>}
              <button type="button" className="bcs-secondary" onClick={close}>Close</button>
            </div>
          </div>
        )}

        {phase === 'reading-photo' && (
          <div className="bcs-panel"><p className="bcs-text">Reading the photo…</p></div>
        )}

        {phase === 'looking-up' && (
          <div className="bcs-panel"><p className="bcs-text">Looking up {scanned}…</p></div>
        )}

        {phase === 'not-found' && (
          <div className="bcs-panel">
            <h4 className="bcs-title">Barcode not found</h4>
            <p className="bcs-text">
              {scanned} was read, but no food with that barcode is in RipFit or the USDA database.
              Check the number, or {manual ? 'search for the food by name.' : 'add the food from a meal’s “+ Add”.'}
            </p>
            <div className="bcs-actions">
              <button type="button" className="bcs-primary" onClick={scanAgain}>Scan again</button>
            </div>
            {typeRow}
            <div className="bcs-actions">
              {manual && <button type="button" className="bcs-secondary" onClick={manual}>Search by name</button>}
              <button type="button" className="bcs-secondary" onClick={close}>Close</button>
            </div>
          </div>
        )}
        {phase === 'denied' && fallback(
          'Camera access is blocked',
          'This site is not allowed to use the camera. To scan live, allow the camera for this site in your browser’s site settings (the icon by the address bar), then tap Try the camera again. A photo or the typed number works without it.',
          { retry: true }
        )}
        {phase === 'unavailable' && fallback(
          'No camera available',
          `${message || 'No camera was found.'} You can still take a photo of the barcode or type its number.`
        )}
        {phase === 'busy-camera' && fallback(
          'The camera is busy',
          'Another app or tab is using the camera. Close it, then tap Try the camera again.',
          { retry: true }
        )}
        {phase === 'error' && fallback('Lookup failed', message, { retry: true })}

        {phase === 'result' && food && (
          <div className="bcs-panel">
            <div className="bcs-food-name">{food.name}</div>
            {food.brand && <div className="bcs-food-brand">{food.brand}</div>}
            {suspicious && (
              <p className="bcs-warning">
                Closest match only — this food's barcode is {food.gtin_upc}, you scanned {scanned}.
              </p>
            )}

            <div className="bcs-qty-row">
              <label htmlFor="bcs-qty">{hasServing ? 'Servings' : 'Quantity'}</label>
              <input
                id="bcs-qty"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.5"
                value={quantity}
                onChange={e => setQuantity(e.target.value)}
              />
              <span className="bcs-qty-unit">
                {hasServing ? `× ${round1(servingSize)} ${servingUnit}` : '× 100 g'}
              </span>
            </div>

            {macros && (
              <div className="bcs-macros">
                <div className="bcs-cal">{macros.cal ?? '—'} <span>cal</span></div>
                {macros.protein != null && <div><span>P</span> {macros.protein}g</div>}
                {macros.carbs != null && <div><span>C</span> {macros.carbs}g</div>}
                {macros.fat != null && <div><span>F</span> {macros.fat}g</div>}
              </div>
            )}

            {logError && <p className="bcs-error">{logError}</p>}

            {mode === 'meal' ? (
              <div className="bcs-actions">
                <button type="button" className="bcs-primary" onClick={() => logFood(mealType)} disabled={logging || !qtyValid}>
                  {logging ? 'Logging…' : `Log to ${mealLabel || 'meal'}`}
                </button>
                {manual && (
                  <button type="button" className="bcs-secondary" onClick={manual} disabled={logging}>
                    Not right? Search manually
                  </button>
                )}
              </div>
            ) : choosingMeal ? (
              <div className="bcs-meal-choice">
                <p className="bcs-text">Add to which meal{dateLabel ? ` (${dateLabel})` : ''}?</p>
                <div className="bcs-meal-grid">
                  {MEALS.map(([key, label]) => (
                    <button key={key} type="button" className="bcs-primary" disabled={logging || !qtyValid} onClick={() => logFood(key)}>
                      {label}
                    </button>
                  ))}
                </div>
                <button type="button" className="bcs-secondary" onClick={() => setChoosingMeal(false)} disabled={logging}>Back</button>
              </div>
            ) : (
              <div className="bcs-actions">
                <button type="button" className="bcs-primary" onClick={() => setChoosingMeal(true)} disabled={!qtyValid}>
                  Add to meal
                </button>
                <button type="button" className="bcs-secondary" onClick={close}>Just checking</button>
                <button type="button" className="bcs-secondary" onClick={scanAgain}>Scan another</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
