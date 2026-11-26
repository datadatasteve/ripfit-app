// Start Set (Phase 0B-2 item 12): the sound schedule recorded from the
// page's oscillators, and the "Reps for this set" field.
const { test, expect } = require('@playwright/test');
const { apiLogin, api, cancelActive, exerciseId, preparePage, recordOscillators, openApp, today } = require('./helpers');

const HZ = { lead: 660, go: 990, tick: 1047, accent: 1568, rep: 784 };

/** The expected schedule for 3-1-2, 3 reps, lead-in 3 (seconds from the first beep). */
function expected312() {
  const out = [[0, HZ.lead], [1, HZ.lead], [2, HZ.lead], [3, HZ.go]];
  for (let r = 0; r < 3; r++) {
    const base = 3 + r * 6;
    // second 0 of each rep: the lead-in "go" (rep 1) or the previous rep's beep
    out.push([base + 1, HZ.tick], [base + 2, HZ.tick]);   // eccentric s2, s3
    out.push([base + 3, HZ.accent]);                      // pause
    out.push([base + 4, HZ.accent], [base + 5, HZ.tick]); // concentric s1, s2
    out.push([base + 6, HZ.rep]);                         // end of rep
  }
  return out;
}

test.describe('Start Set', () => {
  let token;
  test.beforeEach(async ({ request }) => {
    token = await apiLogin(request);
    await cancelActive(request, token);
    const bench = await exerciseId(request, 'Bench Press');
    const ohp = await exerciseId(request, 'Overhead Press');
    const { routine } = await api(request, token, 'POST', '/routines', {
      name: `E2E Tempo ${Date.now()}`,
      exercises: [
        { exercise_id: bench, order_index: 1, target_sets: 1, target_reps_min: 3, target_reps_max: 3,
          tempo_eccentric: 3, tempo_pause: 1, tempo_concentric: 2 },
        { exercise_id: ohp, order_index: 2, target_sets: 1,
          tempo_eccentric: 1, tempo_pause: 1, tempo_concentric: 1 },
      ],
    });
    await api(request, token, 'POST', `/routines/${routine.id}/start-workout`, { workout_date: today() });
  });

  test('3-1-2 tempo, 3 reps, lead-in 3: clicks per rep, one beep per rep, nothing after', async ({ page }) => {
    test.setTimeout(90_000);
    await recordOscillators(page);
    await preparePage(page, token);
    await openApp(page, { resume: true });

    const startSet = page.locator('.aw-start-set-btn');
    await expect(startSet).toHaveText('▶ Start Set · 3 reps');
    await startSet.click();
    await expect(startSet).toHaveText('■ Stop');
    await expect(page.locator('.aw-tempo-run')).toContainText(/Rep 1 of 3/, { timeout: 6_000 });
    // 3 s lead-in + 3 reps × 6 s; the button returns when the set is over.
    await expect(startSet).toHaveText('▶ Start Set · 3 reps', { timeout: 30_000 });
    await page.waitForTimeout(1_500);   // nothing may follow the last beep

    const osc = await page.evaluate(() => window.__osc);
    const t0 = osc[0].t;
    const got = osc.map(o => [Math.round((o.t - t0) * 100) / 100, o.f]);
    const want = expected312();
    expect(got.map(([t, f]) => [Math.round(t), f])).toEqual(want);
    // On time: every beep within 20 ms of its second.
    for (const [t] of got) expect(Math.abs(t - Math.round(t))).toBeLessThan(0.02);
    // The end-of-rep beep is half a second long (stop is set 50 ms after it ends).
    for (const o of osc.filter(x => x.f === HZ.rep)) expect(o.stopAt - o.t).toBeCloseTo(0.55, 2);
    expect(got.filter(([, f]) => f === HZ.rep)).toHaveLength(3);
    expect(got[got.length - 1]).toEqual([21, HZ.rep]);
  });

  test('no target reps: "Reps for this set" field prefilled with 10', async ({ page }) => {
    await preparePage(page, token);
    await openApp(page, { resume: true });
    await page.getByRole('button', { name: /Next/ }).last().click();
    await expect(page.locator('.aw-tempo-label')).toHaveText('Tempo: 1-1-1');
    // Typed reps win, so clear the set form's Reps box first.
    await page.getByPlaceholder('Reps', { exact: true }).fill('');
    const field = page.locator('.aw-set-reps input');
    await expect(field).toHaveValue('10');
    await expect(field).toHaveAttribute('inputmode', 'numeric');
    await expect(page.locator('.aw-start-set-btn')).toHaveText('▶ Start Set · 10 reps');
    await field.fill('4');
    await expect(page.locator('.aw-start-set-btn')).toHaveText('▶ Start Set · 4 reps');
  });
});
