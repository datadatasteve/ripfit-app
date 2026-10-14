import { useState, useEffect, useRef } from 'react';
import './BarcodeScanner.css';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';
const token = () => localStorage.getItem('ripfit_token');
const round1 = n => Math.round((Number(n) || 0) * 10) / 10;

// Same conversions the meal endpoint uses; unknown units count as grams there too.
const UNIT_TO_G = { g: 1, ml: 1, oz: 28.3495, lb: 453.592, kg: 1000 };

const stripZeros = code => String(code || '').replace(/^0+/, '');

/**
 * Live camera barcode scan → existing lookup endpoint
 * (POST /nutrition/foods/barcode/:code, which checks the local foods table and
 * then USDA) → result card → log via the existing POST /nutrition/meals.
 *
 * Every failure path (no camera, permission denied, not found, wrong match)
 * ends on a "Search manually" action, so the user is never dead-ended.
 *
 * The camera is only requested once this mounts (i.e. on the Scan tap), never
 * on page load. Desktop (no touch screen) skips the camera entirely.
 */
export default function BarcodeScanner({ mealType, mealDate, mealLabel, onClose, onLogged, onManualSearch }) {
  // 'starting' | 'scanning' | 'looking-up' | 'result' | 'not-found' | 'denied' | 'unavailable' | 'error'
  const [phase, setPhase] = useState('starting');
  const [message, setMessage] = useState('');
  const [scanned, setScanned] = useState('');
  const [food, setFood] = useState(null);
  const [quantity, setQuantity] = useState('1');
  const [logging, setLogging] = useState(false);
  const [logError, setLogError] = useState('');

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const readerRef = useRef(null);
  const decodedRef = useRef(false);

  const stopCamera = () => {
    try { readerRef.current?.reset(); } catch { /* already stopped */ }
    readerRef.current = null;
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  };

  const lookUp = async (code) => {
    setScanned(code);
    setPhase('looking-up');
    try {
      const res = await fetch(`${API_BASE}/nutrition/foods/barcode/${encodeURIComponent(code)}`, { method: 'POST' });
      if (res.status === 404) { setPhase('not-found'); return; }
      if (!res.ok) throw new Error('Lookup failed');
      const data = await res.json();
      if (!data.food) { setPhase('not-found'); return; }
      setFood(data.food);
      setQuantity('1');
      setPhase('result');
    } catch {
      setMessage('The barcode lookup failed. Check your connection, or search by name.');
      setPhase('error');
    }
  };

  useEffect(() => {
    let cancelled = false;

    const start = async () => {
      const isTouch = window.matchMedia?.('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
      if (!navigator.mediaDevices?.getUserMedia || !isTouch) {
        setPhase('unavailable');
        return;
      }
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      } catch (err) {
        if (cancelled) return;
        if (err?.name === 'NotAllowedError' || err?.name === 'SecurityError') setPhase('denied');
        else setPhase('unavailable');
        return;
      }
      if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
      streamRef.current = stream;

      try {
        // Loaded on first scan only, so it never weighs on the main bundle.
        const { BrowserMultiFormatReader, DecodeHintType, BarcodeFormat } = await import('@zxing/library');
        if (cancelled) { stopCamera(); return; }
        const hints = new Map();
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [
          BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E,
        ]);
        const reader = new BrowserMultiFormatReader(hints);
        readerRef.current = reader;
        setPhase('scanning');
        await reader.decodeFromStream(stream, videoRef.current, (result) => {
          if (!result || decodedRef.current) return;
          decodedRef.current = true;
          // Close the camera the moment we have a code.
          stopCamera();
          lookUp(result.getText());
        });
      } catch {
        if (cancelled) return;
        stopCamera();
        setMessage('The camera started but the scanner could not. Search by name instead.');
        setPhase('error');
      }
    };

    start();
    return () => { cancelled = true; stopCamera(); };
  }, []);

  const close = () => { stopCamera(); onClose(); };
  const manual = () => { stopCamera(); onManualSearch(); };

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

  const logFood = async () => {
    if (!qtyValid) return;
    setLogging(true);
    setLogError('');
    try {
      const res = await fetch(`${API_BASE}/nutrition/meals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({
          meal_date: mealDate,
          meal_type: mealType,
          foods: [{ food_id: food.id, serving_size: totalAmount, serving_unit: totalUnit }],
        }),
      });
      if (!res.ok) throw new Error();
      onLogged();
    } catch {
      setLogError('Could not log this food. Try again.');
      setLogging(false);
    }
  };

  const fallback = (title, body) => (
    <div className="bcs-panel">
      <h4 className="bcs-title">{title}</h4>
      <p className="bcs-text">{body}</p>
      <div className="bcs-actions">
        <button type="button" className="bcs-primary" onClick={manual}>Search manually</button>
        <button type="button" className="bcs-secondary" onClick={close}>Close</button>
      </div>
    </div>
  );

  return (
    <div className="bcs-overlay" role="dialog" aria-modal="true" aria-label="Scan barcode">
      <div className="bcs-sheet">
        <div className="bcs-header">
          <h3>Scan barcode{mealLabel ? ` · ${mealLabel}` : ''}</h3>
          <button type="button" className="bcs-close" onClick={close} aria-label="Close scanner">✕</button>
        </div>

        {(phase === 'starting' || phase === 'scanning') && (
          <div className="bcs-camera">
            <video ref={videoRef} className="bcs-video" playsInline muted autoPlay />
            <div className="bcs-reticle" aria-hidden="true" />
            <p className="bcs-hint">{phase === 'starting' ? 'Starting camera…' : 'Line the barcode up inside the box'}</p>
            <button type="button" className="bcs-secondary bcs-manual-link" onClick={manual}>Search by name instead</button>
          </div>
        )}

        {phase === 'looking-up' && (
          <div className="bcs-panel"><p className="bcs-text">Looking up {scanned}…</p></div>
        )}

        {phase === 'not-found' && fallback(
          "Couldn't find that barcode",
          `No food matched ${scanned}. Search for it by name instead.`
        )}
        {phase === 'denied' && fallback(
          'Camera access was blocked',
          'Allow camera access for this site in your browser settings to scan, or search by name.'
        )}
        {phase === 'unavailable' && fallback(
          'Scanning needs a phone camera',
          'No rear camera is available on this device. Search for the food by name instead.'
        )}
        {phase === 'error' && fallback('Scan failed', message)}

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
            <div className="bcs-actions">
              <button type="button" className="bcs-primary" onClick={logFood} disabled={logging || !qtyValid}>
                {logging ? 'Logging…' : `Log to ${mealLabel || 'meal'}`}
              </button>
              <button type="button" className="bcs-secondary" onClick={manual} disabled={logging}>
                Not right? Search manually
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
