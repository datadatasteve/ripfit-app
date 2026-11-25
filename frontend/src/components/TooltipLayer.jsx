import { useEffect, useRef, useState } from 'react';
import './TooltipLayer.css';

/**
 * The app's one tooltip (Phase 0B-1). Any element with a data-tooltip
 * attribute gets a small label on desktop mouse hover and on keyboard focus.
 * Touch never shows it: a tap fires pointerover with pointerType "touch" and
 * a focus that isn't keyboard focus (:focus-visible), and both are ignored.
 *
 * Icon-only buttons carry the same text in aria-label for screen readers;
 * the tooltip itself is aria-hidden so it isn't read twice.
 */
const SHOW_DELAY_MS = 350;

export default function TooltipLayer() {
  const [tip, setTip] = useState(null);   // { text, top, left, below }
  const timerRef = useRef(null);
  const anchorRef = useRef(null);

  useEffect(() => {
    const clear = () => {
      clearTimeout(timerRef.current);
      anchorRef.current = null;
      setTip(null);
    };
    const show = (el, delay) => {
      clearTimeout(timerRef.current);
      anchorRef.current = el;
      timerRef.current = setTimeout(() => {
        if (anchorRef.current !== el || !el.isConnected) return;
        const text = el.getAttribute('data-tooltip');
        if (!text) return;
        const r = el.getBoundingClientRect();
        const below = r.top < 48;
        setTip({ text, left: r.left + r.width / 2, top: below ? r.bottom + 8 : r.top - 8, below });
      }, delay);
    };
    const target = e => (e.target instanceof Element ? e.target.closest('[data-tooltip]') : null);
    // A tap focuses the button too; a focus within a second of a touch is
    // that tap, not keyboard navigation.
    let lastTouchAt = 0;
    const onPointerDown = (e) => {
      if (e.pointerType === 'touch' || e.pointerType === 'pen') lastTouchAt = Date.now();
      clear();
    };

    const onOver = (e) => {
      if (e.pointerType !== 'mouse') return;
      const el = target(e);
      if (el) { if (el !== anchorRef.current) show(el, SHOW_DELAY_MS); }
      else if (anchorRef.current && document.activeElement !== anchorRef.current) clear();
    };
    const onFocus = (e) => {
      const el = target(e);
      if (!el || Date.now() - lastTouchAt < 1000) return;
      let keyboard = false;
      try { keyboard = el.matches(':focus-visible'); } catch { keyboard = false; }
      if (keyboard) show(el, 0);
    };
    const onOut = (e) => {
      if (anchorRef.current && (!e.relatedTarget || !anchorRef.current.contains(e.relatedTarget))) clear();
    };
    const onKey = (e) => { if (e.key === 'Escape') clear(); };

    document.addEventListener('pointerover', onOver);
    document.addEventListener('pointerout', onOut);
    document.addEventListener('focusin', onFocus);
    document.addEventListener('focusout', clear);
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', clear, true);
    return () => {
      clearTimeout(timerRef.current);
      document.removeEventListener('pointerover', onOver);
      document.removeEventListener('pointerout', onOut);
      document.removeEventListener('focusin', onFocus);
      document.removeEventListener('focusout', clear);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', clear, true);
    };
  }, []);

  if (!tip) return null;
  return (
    <div
      className={`app-tooltip ${tip.below ? 'below' : 'above'}`}
      style={{ top: tip.top, left: tip.left }}
      aria-hidden="true"
    >
      {tip.text}
    </div>
  );
}
