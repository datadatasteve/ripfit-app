// Cardio display (Phase 0B-2 item 12): segments on the workout detail page,
// and Stats > Cardio "Avg Distance" is an average, not the total.
const { test, expect } = require('@playwright/test');
const { apiLogin, api, cancelActive, exerciseId, preparePage, openApp, today, goTo } = require('./helpers');

async function quickCardio(request, token, treadmill, title, segments) {
  const { workout } = await api(request, token, 'POST', '/workouts/start-free',
    { workout_date: today(), workout_type: 'cardio', workout_title: title });
  const we = await api(request, token, 'POST', `/workouts/${workout.id}/exercises`, { exercise_id: treadmill, order_index: 1 });
  for (const [i, s] of segments.entries()) {
    await api(request, token, 'POST', `/workouts/${workout.id}/exercises/${we.id}/cardio-segments`,
      { segment_number: i + 1, distance_unit: 'mi', ...s });
  }
  await api(request, token, 'PUT', `/workouts/${workout.id}/finish`, {});
  return workout.id;
}

test.describe('cardio display', () => {
  let token;
  test.beforeEach(async ({ request }) => {
    token = await apiLogin(request);
    await cancelActive(request, token);
  });

  test('detail page shows segments for Quick Cardio and for an Open workout', async ({ page, request }) => {
    const treadmill = await exerciseId(request, 'Treadmill');
    const bench = await exerciseId(request, 'Bench Press');
    const stamp = Date.now();
    await quickCardio(request, token, treadmill, `E2E QC ${stamp}`, [
      { duration_seconds: 900, distance: 1.5 }, { duration_seconds: 300, distance: 0.5 },
    ]);
    const { workout } = await api(request, token, 'POST', '/workouts/start-free',
      { workout_date: today(), workout_type: 'open', workout_title: `E2E Open ${stamp}` });
    const wb = await api(request, token, 'POST', `/workouts/${workout.id}/exercises`, { exercise_id: bench, order_index: 1 });
    const wt = await api(request, token, 'POST', `/workouts/${workout.id}/exercises`, { exercise_id: treadmill, order_index: 2 });
    await api(request, token, 'POST', `/workouts/${workout.id}/sets`, { workout_exercise_id: wb.id, set_number: 1, reps_completed: 5, weight_used: 100 });
    await api(request, token, 'POST', `/workouts/${workout.id}/exercises/${wt.id}/cardio-segments`,
      { segment_number: 1, duration_seconds: 480, distance: 1, distance_unit: 'mi' });
    await api(request, token, 'PUT', `/workouts/${workout.id}/finish`, {});

    await preparePage(page, token);
    await openApp(page);
    await goTo(page, 'Stats');
    await page.getByRole('button', { name: 'History', exact: true }).click();

    await page.getByText(`E2E QC ${stamp}`).first().click();
    const qcRows = page.locator('.wdp-segments-table tbody tr');
    await expect(qcRows).toHaveCount(2);
    await expect(qcRows.nth(0)).toHaveText(/1\s*15:00\s*1\.5 mi/);
    await expect(qcRows.nth(1)).toHaveText(/2\s*5:00\s*0\.5 mi/);
    await page.locator('.wdp-back').click();

    await page.getByText(`E2E Open ${stamp}`).first().click();
    await expect(page.locator('.wdp-exercise', { hasText: 'Bench Press' }).locator('.wdp-sets-table')).toBeVisible();
    const openRows = page.locator('.wdp-exercise', { hasText: 'Treadmill' }).locator('.wdp-segments-table tbody tr');
    await expect(openRows).toHaveCount(1);
    await expect(openRows.first()).toHaveText(/1\s*8:00\s*1 mi/);
  });

  test('Stats > Cardio Avg Distance is the average over sessions with a distance', async ({ page, request }) => {
    const treadmill = await exerciseId(request, 'Treadmill');
    const stamp = Date.now();
    await quickCardio(request, token, treadmill, `E2E Avg A ${stamp}`, [{ duration_seconds: 1200, distance: 2 }]);
    await quickCardio(request, token, treadmill, `E2E Avg B ${stamp}`, [{ duration_seconds: 600, distance: 1 }]);
    await quickCardio(request, token, treadmill, `E2E Avg C ${stamp}`, [{ duration_seconds: 300 }]);   // no distance

    // Expected from the same data the page uses (this user's history grows each run).
    const stats = await api(request, token, 'GET', '/stats/cardio');
    const rows = stats.time_series.filter(r => r.cardio_type === 'Treadmill');
    const withDist = rows.map(r => parseFloat(r.distance || 0)).filter(d => d > 0);
    const total = withDist.reduce((a, b) => a + b, 0);
    const avg = Math.round((total / withDist.length) * 100) / 100;
    expect(rows.length).toBeGreaterThan(withDist.length);   // a session without distance is in the selection
    const summary = stats.summary.find(s => s.cardio_type === 'Treadmill');
    expect(summary.avg_distance).toBe(avg);
    expect(summary.total_distance).toBeCloseTo(total, 2);

    await preparePage(page, token);
    await openApp(page);
    await goTo(page, 'Stats');
    await page.getByRole('button', { name: 'Cardio', exact: true }).click();
    const row = page.locator('table.sc-table tr', { hasText: 'Treadmill' }).first();
    const header = await page.locator('table.sc-table', { hasText: 'Avg Distance' }).locator('th').allTextContents();
    const col = header.indexOf('Avg Distance');
    expect(col).toBeGreaterThan(-1);
    await expect(row.locator('td').nth(col)).toHaveText(String(avg));
    expect(String(avg)).not.toBe(String(Math.round(total * 100) / 100));
  });
});
