// Shared helpers for the RipFit e2e suite (Phase 0B-2).
const { expect } = require('@playwright/test');

const API = process.env.E2E_API_URL || 'http://localhost:3000/api/v1';
const USER = { email: 'e2e@ripfit.test', password: 'E2e-Local-Pass1!' };   // seed/seed.sql
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Logs the seeded e2e user in through the API and returns a token. */
async function apiLogin(request) {
  const res = await request.post(`${API}/auth/login`, { data: USER });
  expect(res.status(), 'Login failed: did you run seed/seed.sql? (see README)').toBe(200);
  return (await res.json()).token;
}

/** Calls the local API with the token; fails the test on a non-2xx status. */
async function api(request, token, method, path, data) {
  const res = await request.fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}` },
    ...(data !== undefined ? { data } : {}),
  });
  const body = await res.json().catch(() => null);
  expect(res.ok(), `${method} ${path} → ${res.status()} ${JSON.stringify(body)}`).toBeTruthy();
  return body;
}

/** Cancels any workout left in progress, so each test starts clean. */
async function cancelActive(request, token) {
  const active = await api(request, token, 'GET', '/workouts/active');
  const id = active?.workout?.id;
  if (id) await api(request, token, 'PUT', `/workouts/${id}/cancel`, {});
}

async function exerciseId(request, name) {
  const res = await request.get(`${API}/workouts/exercises/search?q=${encodeURIComponent(name)}`);
  const body = await res.json();
  const ex = body.exercises.find(e => e.name === name);
  expect(ex, `exercise "${name}" not found in the local exercises table`).toBeTruthy();
  return ex.id;
}

/**
 * Blocks every request that leaves localhost (no USDA, no fonts, nothing
 * external), and signs the page in by putting the token where the app keeps it.
 */
async function preparePage(page, token) {
  await page.context().route('**/*', route => {
    const host = new URL(route.request().url()).hostname;
    return LOCAL_HOSTS.has(host) ? route.continue() : route.abort();
  });
  if (token) {
    await page.addInitScript(t => {
      if (!sessionStorage.getItem('__e2e_signed_in')) {
        localStorage.setItem('ripfit_token', t);
        sessionStorage.setItem('__e2e_signed_in', '1');
      }
    }, token);
  }
}

/** Records every oscillator the page starts: { t, f, type, len } on the audio clock. */
async function recordOscillators(page) {
  await page.addInitScript(() => {
    window.__osc = [];
    const P = (window.AudioContext || window.webkitAudioContext)?.prototype;
    if (!P || P.__e2ePatched) return;
    P.__e2ePatched = true;
    const orig = P.createOscillator;
    P.createOscillator = function () {
      const o = orig.call(this);
      const start = o.start.bind(o), stop = o.stop.bind(o);
      let rec = null;
      o.start = (t = 0) => { rec = { t, f: o.frequency.value, type: o.type }; window.__osc.push(rec); return start(t); };
      o.stop = (t) => { if (rec && t !== undefined && rec.stopAt === undefined) rec.stopAt = t; return stop(t); };
      return o;
    };
  });
}

/** Opens the app; resumes the active workout if the "Unfinished workout" prompt shows. */
async function openApp(page, { resume = false } = {}) {
  await page.goto('./');
  if (resume) {
    await page.getByRole('button', { name: 'Resume', exact: true }).click();
  }
}

/**
 * Goes to a top-level page (Workouts, Exercises, Stats, Nutrition). On a
 * narrow screen those live behind the "Open menu" button.
 */
async function goTo(page, name) {
  const menu = page.getByRole('button', { name: 'Open menu', exact: true });
  if (await menu.isVisible()) {
    await menu.click();
    await page.getByRole('dialog').getByRole('button', { name, exact: true }).click();
  } else {
    await page.getByRole('banner').getByRole('link', { name: new RegExp(`^${name}\\b`) }).click();
  }
}

module.exports = { goTo, API, USER, today, apiLogin, api, cancelActive, exerciseId, preparePage, recordOscillators, openApp };
