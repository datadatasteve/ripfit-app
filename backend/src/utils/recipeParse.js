// Rules-based recipe parsing (Phase 1B-1). No AI calls.
//
// parseIngredientLine("1 1/2 cups rolled oats, dry") →
//   { raw_text, quantity: 1.5, unit: 'cup', name: 'rolled oats', notes: 'dry' }
// Lines it cannot read keep raw_text only (quantity/unit null, name = the line).

const UNICODE_FRACTIONS = { '½': 0.5, '⅓': 1 / 3, '⅔': 2 / 3, '¼': 0.25, '¾': 0.75, '⅕': 0.2, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875 };
// unit word → canonical unit
const UNITS = {
  cup: 'cup', cups: 'cup', c: 'cup',
  tablespoon: 'tbsp', tablespoons: 'tbsp', tbsp: 'tbsp', tbs: 'tbsp', tbl: 'tbsp', t: 'tbsp',
  teaspoon: 'tsp', teaspoons: 'tsp', tsp: 'tsp',
  gram: 'g', grams: 'g', g: 'g', gr: 'g', kilogram: 'kg', kilograms: 'kg', kg: 'kg',
  ounce: 'oz', ounces: 'oz', oz: 'oz', pound: 'lb', pounds: 'lb', lb: 'lb', lbs: 'lb',
  milliliter: 'ml', milliliters: 'ml', millilitre: 'ml', millilitres: 'ml', ml: 'ml',
  liter: 'l', liters: 'l', litre: 'l', litres: 'l', l: 'l',
  'fl oz': 'fl oz', pint: 'pint', pints: 'pint', quart: 'quart', quarts: 'quart',
  pinch: 'pinch', pinches: 'pinch', dash: 'dash', clove: 'clove', cloves: 'clove',
  can: 'can', cans: 'can', slice: 'slice', slices: 'slice', piece: 'piece', pieces: 'piece',
  stick: 'stick', sticks: 'stick', bunch: 'bunch', handful: 'handful', package: 'package', packages: 'package',
  scoop: 'scoop', scoops: 'scoop',
};

function parseNumber(s) {
  s = s.trim();
  if (UNICODE_FRACTIONS[s] !== undefined) return UNICODE_FRACTIONS[s];
  let m = s.match(/^(\d+)\s*([½⅓⅔¼¾⅕⅛⅜⅝⅞])$/);
  if (m) return Number(m[1]) + UNICODE_FRACTIONS[m[2]];
  m = s.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (m) return Number(m[1]) + Number(m[2]) / Number(m[3]);
  m = s.match(/^(\d+)\/(\d+)$/);
  if (m) return Number(m[2]) === 0 ? null : Number(m[1]) / Number(m[2]);
  m = s.match(/^\d+(?:[.,]\d+)?$/);
  if (m) return Number(s.replace(',', '.'));
  return null;
}

const QTY_RE = /^((?:\d+\s+\d+\/\d+)|(?:\d+\/\d+)|(?:\d+\s*[½⅓⅔¼¾⅕⅛⅜⅝⅞])|(?:[½⅓⅔¼¾⅕⅛⅜⅝⅞])|(?:\d+(?:[.,]\d+)?))(?:\s*(?:-|–|to)\s*(?:\d+(?:[.,]\d+)?|\d+\/\d+))?/;

function parseIngredientLine(line) {
  const raw = String(line || '').replace(/\s+/g, ' ').trim().replace(/^[-*•▢□]\s*/, '');
  if (!raw) return null;
  const out = { raw_text: raw, quantity: null, unit: null, name: raw, notes: null };
  const q = raw.match(QTY_RE);
  let rest = raw;
  if (q) {
    const n = parseNumber(q[1]);
    if (n !== null && Number.isFinite(n)) { out.quantity = Math.round(n * 1000) / 1000; rest = raw.slice(q[0].length).trim(); }
  }
  // "(14 oz)" style size right after the number is kept in notes
  const paren = rest.match(/^\(([^)]*)\)\s*/);
  let sizeNote = null;
  if (paren && out.quantity !== null) { sizeNote = paren[1]; rest = rest.slice(paren[0].length); }
  const fl = rest.match(/^fl\.?\s*oz\.?\b\s*/i);
  if (fl) { out.unit = 'fl oz'; rest = rest.slice(fl[0].length); }
  else {
    const u = rest.match(/^([A-Za-z]+)\.?(?=\s|$)\s*/);
    if (u && UNITS[u[1].toLowerCase()] && (out.quantity !== null || ['pinch', 'dash', 'handful'].includes(u[1].toLowerCase()))) {
      // single-letter units only right after a number ("2 c flour"), never as a word
      if (u[1].length > 1 || out.quantity !== null) { out.unit = UNITS[u[1].toLowerCase()]; rest = rest.slice(u[0].length); }
    }
  }
  rest = rest.replace(/^of\s+/i, '').trim();
  const comma = rest.indexOf(',');
  let notes = null;
  if (comma > 0) { notes = rest.slice(comma + 1).trim() || null; rest = rest.slice(0, comma).trim(); }
  out.name = rest || raw;
  out.notes = [sizeNote, notes].filter(Boolean).join('; ') || null;
  return out;
}

/** Turns a schema.org duration, string or number into text; yields like "4 servings" → 4. */
function servingsOf(v) {
  if (Array.isArray(v)) v = v[0];
  if (v === null || v === undefined) return null;
  const m = String(v).match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
}

const decode = s => String(s).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
  .replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
  .replace(/\s+/g, ' ').trim();

function stepsOf(instr) {
  const out = [];
  const walk = (x) => {
    if (!x) return;
    if (typeof x === 'string') { decode(x).split(/\n+/).map(s => s.trim()).filter(Boolean).forEach(s => out.push(s)); return; }
    if (Array.isArray(x)) { x.forEach(walk); return; }
    if (typeof x === 'object') {
      if (x.itemListElement) walk(x.itemListElement);
      else if (x.text) out.push(decode(x.text));
      else if (x.name) out.push(decode(x.name));
    }
  };
  walk(instr);
  return out;
}

const hasType = (o, t) => o && (o['@type'] === t || (Array.isArray(o['@type']) && o['@type'].includes(t)));

/** Finds the first schema.org Recipe in a page's JSON-LD blocks. */
function recipeFromHtml(html, pageUrl) {
  const blocks = [...String(html).matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const b of blocks) {
    let data;
    try { data = JSON.parse(b[1].trim()); } catch (_) { continue; }
    const stack = Array.isArray(data) ? [...data] : [data];
    while (stack.length) {
      const o = stack.shift();
      if (!o || typeof o !== 'object') continue;
      if (hasType(o, 'Recipe')) {
        const author = Array.isArray(o.author) ? o.author[0] : o.author;
        return {
          name: decode(o.name || 'Imported recipe'),
          servings: servingsOf(o.recipeYield),
          ingredients: (o.recipeIngredient || o.ingredients || []).map(decode),
          steps: stepsOf(o.recipeInstructions),
          notes: o.description ? decode(o.description) : null,
          source_url: typeof o.url === 'string' ? o.url : pageUrl,
          source_title: decode(o.name || ''),
          source_author: author ? decode(typeof author === 'string' ? author : author.name || '') || null : null,
        };
      }
      if (Array.isArray(o['@graph'])) stack.push(...o['@graph']);
      if (Array.isArray(o)) stack.push(...o);
    }
  }
  return null;
}

const ING_HEAD = /^(ingredients?)\s*:?$/i;
const STEP_HEAD = /^(instructions?|directions?|method|steps?|preparation)\s*:?$/i;
const NOTES_HEAD = /^(notes?)\s*:?$/i;
const YIELD_RE = /^(serves|servings?|yield|makes)\s*:?\s*(.+)$/i;
const SOURCE_RE = /^(source|from|adapted from|by)\s*:\s*(.+)$/i;

/**
 * Pasted text: first line = title. Sections by headings (Ingredients /
 * Instructions / Notes). Without headings, lines starting with a quantity are
 * ingredients and the rest are steps. "Serves 4" sets servings.
 */
function recipeFromText(text) {
  const lines = String(text).replace(/\r/g, '').split('\n').map(l => l.trim()).filter(Boolean);
  if (!lines.length) return null;
  const r = { name: lines[0].replace(/^#+\s*/, ''), servings: null, ingredients: [], steps: [], notes: null, source_author: null, source_url: null, source_title: null };
  let section = null; const notes = []; let sawHeadings = false;
  for (const l of lines.slice(1)) {
    const y = l.match(YIELD_RE); if (y) { r.servings = servingsOf(y[2]); continue; }
    const src = l.match(SOURCE_RE);
    if (src) { const v = src[2].trim(); if (/^https?:\/\//i.test(v)) r.source_url = v; else r.source_author = v; continue; }
    if (ING_HEAD.test(l)) { section = 'ing'; sawHeadings = true; continue; }
    if (STEP_HEAD.test(l)) { section = 'step'; sawHeadings = true; continue; }
    if (NOTES_HEAD.test(l)) { section = 'notes'; sawHeadings = true; continue; }
    const clean = l.replace(/^(\d+[.)]|step\s*\d+[:.]?)\s+/i, '');
    if (section === 'ing') r.ingredients.push(l);
    else if (section === 'step') r.steps.push(clean);
    else if (section === 'notes') notes.push(l);
    else if (!sawHeadings && QTY_RE.test(l.replace(/^[-*•]\s*/, ''))) r.ingredients.push(l);
    else r.steps.push(clean);
  }
  r.notes = notes.join('\n') || null;
  return r;
}

/** Minimal CSV reader (quotes, escaped quotes, commas, newlines in quotes). */
function parseCsv(text) {
  const rows = []; let row = []; let cell = ''; let q = false;
  const s = String(text).replace(/\r\n?/g, '\n');
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (q) {
      if (ch === '"' && s[i + 1] === '"') { cell += '"'; i += 1; } else if (ch === '"') q = false; else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; } else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ''));
}

/**
 * CSV: a header row with any of: name, servings, ingredient, step, notes,
 * source_url, source_title, source_author. Each row adds its ingredient and/or
 * step to the recipe named in `name` (rows of one recipe can repeat the name
 * or leave it empty after the first). JSON: one recipe object or a list, with
 * { name, servings, ingredients: [string | {quantity, unit, name}], steps: [string],
 *   notes, source: { url, title, author } }.
 */
function recipesFromFile(format, content) {
  if (format === 'json') {
    let data;
    try { data = JSON.parse(content); } catch (_) { throw new Error('content is not valid JSON'); }
    const list = Array.isArray(data) ? data : Array.isArray(data?.recipes) ? data.recipes : [data];
    return list.map(o => ({
      name: String(o?.name || o?.title || '').trim(),
      servings: servingsOf(o?.servings ?? o?.yield),
      ingredients: (Array.isArray(o?.ingredients) ? o.ingredients : []).map(i => (typeof i === 'string' ? i
        : [i?.quantity, i?.unit, i?.name].filter(x => x !== undefined && x !== null && x !== '').join(' '))),
      steps: (Array.isArray(o?.steps) ? o.steps : Array.isArray(o?.instructions) ? o.instructions : []).map(String),
      notes: o?.notes ? String(o.notes) : null,
      source_url: o?.source?.url || o?.source_url || null,
      source_title: o?.source?.title || o?.source_title || null,
      source_author: o?.source?.author || o?.source_author || null,
    }));
  }
  const rows = parseCsv(content);
  if (rows.length < 2) throw new Error('CSV needs a header row and at least one data row');
  const head = rows[0].map(h => h.trim().toLowerCase());
  if (!head.includes('name')) throw new Error('CSV header needs a "name" column');
  const col = k => head.indexOf(k);
  const byName = new Map(); let current = null;
  for (const r of rows.slice(1)) {
    const get = k => (col(k) >= 0 ? (r[col(k)] || '').trim() : '');
    const name = get('name') || current;
    if (!name) continue;
    current = name;
    if (!byName.has(name)) byName.set(name, { name, servings: null, ingredients: [], steps: [], notes: null, source_url: null, source_title: null, source_author: null });
    const rec = byName.get(name);
    if (get('servings')) rec.servings = servingsOf(get('servings'));
    if (get('ingredient')) rec.ingredients.push(get('ingredient'));
    if (get('step')) rec.steps.push(get('step'));
    if (get('notes')) rec.notes = rec.notes ? `${rec.notes}\n${get('notes')}` : get('notes');
    for (const k of ['source_url', 'source_title', 'source_author']) if (get(k)) rec[k] = get(k);
  }
  return [...byName.values()];
}

module.exports = { parseIngredientLine, recipeFromHtml, recipeFromText, recipesFromFile, parseCsv, servingsOf };
