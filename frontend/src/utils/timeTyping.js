/**
 * Time boxes typed on a phone's number keypad (Phase 0B-2).
 *
 * Duration and pace boxes (MM:SS) used a text keyboard because they need a
 * colon, and phone number keypads have no ":" key. With `TIME_INPUT_PROPS`
 * the number keypad opens, and `formatTimeTyping` puts the colon in as the
 * digits are typed:
 *   "45"   → "45"     one or two digits stay whole minutes, as before
 *   "830"  → "8:30"   three or more digits: the last two are seconds
 *   "2530" → "25:30"
 * A value with a "." (decimal minutes, e.g. 8.5, typed on a desktop) is left
 * as typed, and a pasted "8:30" comes out the same. The fields' own parsers
 * are unchanged: they read "M:SS" or a plain number of minutes.
 */
export const TIME_INPUT_PROPS = Object.freeze({ type: 'text', inputMode: 'numeric', autoComplete: 'off' });

export function formatTimeTyping(raw) {
  const text = String(raw ?? '');
  if (text.includes('.')) {
    // Decimal minutes: keep digits and the first dot only.
    const [whole, ...rest] = text.replace(/[^\d.]/g, '').split('.');
    return `${whole}.${rest.join('')}`;
  }
  const digits = text.replace(/\D/g, '').slice(0, 6);
  if (digits.length <= 2) return digits;
  const minutes = digits.slice(0, -2).replace(/^0+(?=\d)/, '');
  return `${minutes}:${digits.slice(-2)}`;
}
