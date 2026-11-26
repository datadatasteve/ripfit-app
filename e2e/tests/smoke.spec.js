// Smoke tests (Phase 0B-2 item 11): login, workout with an RPE 11 set,
// a food from the local foods table, and the Stats tabs.
const { test, expect } = require('@playwright/test');
const { USER, today, apiLogin, api, cancelActive, exerciseId, preparePage, openApp, goTo } = require('./helpers');

test.describe('smoke', () => {
  let token;
  test.beforeEach(async ({ request }) => {
    token = await apiLogin(request);
    await cancelActive(request, token);
  });

  test('login through the form', async ({ page }) => {
    await preparePage(page, null);
    await page.goto('./');
    await page.getByPlaceholder('Email').fill(USER.email);
    await page.getByPlaceholder('Password').fill(USER.password);
    // Two "Log In" buttons: the mode tab, then the submit button.
    await page.getByRole('button', { name: 'Log In', exact: true }).last().click();
    await expect(page.getByText('Log a Workout')).toBeVisible();
    expect(await page.evaluate(() => !!localStorage.getItem('ripfit_token'))).toBe(true);
  });

  test('start a workout, log a set with RPE 11, finish', async ({ page, request }) => {
    const bench = await exerciseId(request, 'Bench Press');
    const name = `E2E Smoke ${Date.now()}`;
    const { routine } = await api(request, token, 'POST', '/routines', {
      name, exercises: [{ exercise_id: bench, order_index: 1, target_sets: 1, target_reps_min: 5, target_reps_max: 5 }],
    });

    await preparePage(page, token);
    await openApp(page);
    await page.getByPlaceholder('Search routines…').fill(name);
    const card = page.locator('div').filter({ hasText: name }).filter({ has: page.getByRole('button', { name: 'Start Workout' }) }).last();
    await card.getByRole('button', { name: 'Start Workout' }).click();

    await page.getByPlaceholder('Reps', { exact: true }).fill('5');
    await page.getByPlaceholder(/^Weight/).fill('95');
    await page.getByPlaceholder('RPE', { exact: true }).fill('11');
    await page.getByRole('button', { name: 'Complete Set' }).click();
    await expect(page.getByText(/Sets Logged/)).toBeVisible();

    const active = await api(request, token, 'GET', '/workouts/active');
    const workoutId = active.workout.id;
    expect(active.workout.routine_id).toBe(routine.id);

    await page.getByRole('button', { name: 'Finish workout' }).click();
    await page.locator('.modal-content').getByRole('button', { name: /^Finish (Workout|Anyway)$/ }).click();
    await expect.poll(async () => (await api(request, token, 'GET', `/workouts/history/${workoutId}`)).status).toBe('completed');

    const detail = await api(request, token, 'GET', `/workouts/history/${workoutId}`);
    const set = detail.exercises[0].sets[0];
    expect(set.reps).toBe(5);
    expect(Number(set.rpe)).toBe(11);
  });

  test('log a food from the local foods table', async ({ page, request }) => {
    // The food search box asks the backend's usda-search route, which calls
    // USDA. The suite makes no external calls, so that one request is
    // answered with the seeded local food (a real foods row, real id).
    const search = await api(request, token, 'GET', '/nutrition/foods/search?q=E2E%20Rolled');
    const food = (search.foods || search).find(f => f.name === 'E2E Rolled Oats');
    expect(food, 'seeded food missing: run seed/seed.sql').toBeTruthy();

    await preparePage(page, token);
    await page.route('**/nutrition/foods/usda-search**', route =>
      route.fulfill({ json: { foods: [food] } }));
    const before = await api(request, token, 'GET', `/nutrition/meals/${today()}`);
    const count = list => JSON.stringify(list).split('E2E Rolled Oats').length - 1;

    await openApp(page);
    await goTo(page, 'Nutrition');
    await page.locator('.nutri-add-food-btn').first().click();
    await page.getByPlaceholder(/Search foods/).fill('E2E Rolled');
    await page.locator('.nutri-result-item', { hasText: 'E2E Rolled Oats' }).click();
    await page.locator('.nutri-add-btn').click();

    await expect.poll(async () => count(await api(request, token, 'GET', `/nutrition/meals/${today()}`)))
      .toBe(count(before) + 1);
  });

  test('Stats: Overview, History and Cardio load without errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
    page.on('response', r => { if (r.url().includes('/api/') && r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });

    await preparePage(page, token);
    await openApp(page);
    await goTo(page, 'Stats');
    for (const tab of ['Overview', 'History', 'Cardio']) {
      await page.getByRole('button', { name: tab, exact: true }).click();
      await page.waitForLoadState('networkidle');
    }
    await expect(page.getByText('Avg Distance').or(page.getByText(/No cardio/i)).first()).toBeVisible();
    expect(errors).toEqual([]);
  });
});
