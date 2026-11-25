/**
 * App-wide rules for <input type="number"> (Phase 0B-1), installed once at
 * start-up so every number field follows them, including ones added later:
 *
 * - the mouse wheel never changes a value (a focused field is blurred
 *   instead, so the page scrolls);
 * - no negative values or exponents can be typed or pasted ("-", "+", "e");
 *   a field that really needs negatives can opt out with data-allow-negative;
 * - fields marked inputMode="numeric" (reps, sets, seconds...) take whole
 *   numbers only, so "." and "," are refused there.
 *
 * Keypads come from each field's own inputMode attribute (numeric for whole
 * numbers, decimal for weight and amounts), and min="0" stops the spinner and
 * arrow keys below zero.
 */
const isNumberInput = el => el instanceof HTMLInputElement && el.type === 'number';
const wholeOnly = el => el.inputMode === 'numeric';
const allowNegative = el => el.hasAttribute('data-allow-negative');

function allowedText(el, text) {
  if (/[eE+]/.test(text)) return false;
  if (text.includes('-') && !allowNegative(el)) return false;
  if (wholeOnly(el) && /[.,]/.test(text)) return false;
  return /^-?[\d.,]*$/.test(text.trim());
}

export function installNumberInputGuards() {
  if (typeof document === 'undefined' || window.__ripfitNumberGuards) return;
  window.__ripfitNumberGuards = true;

  document.addEventListener('wheel', (e) => {
    const el = document.activeElement;
    if (isNumberInput(el) && el.contains(e.target)) el.blur();
  }, { passive: true, capture: true });

  document.addEventListener('keydown', (e) => {
    const el = e.target;
    if (!isNumberInput(el) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key.length !== 1) return;   // arrows, Backspace, Tab...
    if (!allowedText(el, e.key)) e.preventDefault();
  }, true);

  // Mobile keyboards (Android especially) often send keydown with key
  // "Unidentified", and some input methods insert text with no key event at
  // all, so the text about to be inserted is checked here as well.
  document.addEventListener('beforeinput', (e) => {
    const el = e.target;
    if (!isNumberInput(el) || typeof e.data !== 'string' || e.data === '') return;
    if (!allowedText(el, e.data)) e.preventDefault();
  }, true);

  document.addEventListener('paste', (e) => {
    const el = e.target;
    if (!isNumberInput(el)) return;
    const text = e.clipboardData?.getData('text') ?? '';
    if (!allowedText(el, text)) e.preventDefault();
  }, true);
}
