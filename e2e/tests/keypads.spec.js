// Number keypads (Phase 0B-2 item 12): every number box on these screens
// asks for the right phone keypad in its markup (inputmode), and the MM:SS
// boxes use the number keypad with the colon filled in.
const { test, expect } = require('@playwright/test');
const { apiLogin, api, cancelActive, exerciseId, preparePage, openApp, today } = require('./helpers');

/** Every visible input on the page with its type, inputmode and placeholder. */
async function inputsIn(page, selector) {
  return page.locator(selector).locator('input').evaluateAll(els => els
    .filter(e => !['checkbox', 'radio', 'hidden', 'file', 'range'].includes(e.type) && e.offsetParent !== null)
    .map(e => ({ type: e.type, inputMode: e.inputMode || '', placeholder: e.placeholder || e.getAttribute('aria-label') || '' })));
}

const TIME_BOX = /MM:SS|^Pace|Goal Pace|e\.g\. 8:30/;

/** Number boxes need numeric or decimal; time boxes need numeric; nothing else is checked. */
function checkKeypads(inputs) {
  const numberish = inputs.filter(i => i.type === 'number' || TIME_BOX.test(i.placeholder));
  expect(numberish.length).toBeGreaterThan(0);
  for (const i of numberish) {
    expect.soft(['numeric', 'decimal'], `${i.placeholder} (${i.type})`).toContain(i.inputMode);
    if (TIME_BOX.test(i.placeholder)) expect.soft(i.inputMode, i.placeholder).toBe('numeric');
  }
  return numberish;
}

test.describe('number keypads', () => {
  let token;
  test.beforeEach(async ({ request }) => {
    token = await apiLogin(request);
    await cancelActive(request, token);
  });

  test('Quick Cardio: goals screen and segment form', async ({ page, request }) => {
    await preparePage(page, token);
    await openApp(page);
    await page.getByRole('button', { name: 'Quick Cardio', exact: true }).click();
    await page.getByRole('button', { name: 'Treadmill', exact: true }).click();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    const goals = checkKeypads(await inputsIn(page, 'body'));
    expect(goals.map(g => g.placeholder)).toEqual(expect.arrayContaining(['e.g. 45', 'e.g. 5', 'e.g. 8:30']));
    await page.getByPlaceholder('e.g. 8:30').pressSequentially('830');
    await expect(page.getByPlaceholder('e.g. 8:30')).toHaveValue('8:30');

    const starts = page.getByRole('button', { name: 'Start Workout', exact: true });
    await starts.last().click();
    await page.locator('.cardio-segment-form').waitFor();
    const form = await inputsIn(page, '.cardio-segment-form');
    const boxes = checkKeypads(form);
    const byName = Object.fromEntries(boxes.map(b => [b.placeholder.replace(/ ←.*$/, ''), `${b.type}/${b.inputMode}`]));
    expect(byName).toMatchObject({
      'Duration (MM:SS)': 'text/numeric',
      'Distance (mi)': 'number/decimal',
      'Pace (min/mile)': 'text/numeric',
      'Avg speed': 'number/decimal',
      'Max speed': 'number/decimal',
    });
    const duration = page.getByPlaceholder(/^Duration \(MM:SS\)/);
    await duration.pressSequentially('2530');
    await expect(duration).toHaveValue('25:30');
    await duration.fill('');
    await duration.pressSequentially('45');
    await expect(duration).toHaveValue('45');   // one or two digits stay minutes

    await api(request, token, 'PUT', `/workouts/${(await api(request, token, 'GET', '/workouts/active')).workout.id}/cancel`, {});
  });

  test('strength set form and the add-exercise targets', async ({ page, request }) => {
    const bench = await exerciseId(request, 'Bench Press');
    const { routine } = await api(request, token, 'POST', '/routines', {
      name: `E2E Keypad ${Date.now()}`,
      exercises: [{ exercise_id: bench, order_index: 1, target_sets: 1, target_reps_min: 5, target_reps_max: 8 }],
    });
    await api(request, token, 'POST', `/routines/${routine.id}/start-workout`, { workout_date: today() });
    await preparePage(page, token);
    await openApp(page, { resume: true });

    await page.locator('.set-form').first().waitFor();
    const setForm = await inputsIn(page, '.set-form');
    const map = Object.fromEntries(checkKeypads(setForm).map(b => [b.placeholder.replace(/ \(.*\)$/, ''), b.inputMode]));
    expect(map).toMatchObject({ Reps: 'numeric', Weight: 'decimal', RPE: 'numeric' });

    // Add a cardio exercise: its targets use the time boxes.
    await page.getByRole('button', { name: 'Add Exercise', exact: true }).click();
    await page.getByPlaceholder('Search exercises...').fill('Walking');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await page.getByText('Cardio · Walking', { exact: false }).or(page.locator('text=Walking').nth(1)).first().click();
    await page.locator('.target-form').waitFor();
    const targets = checkKeypads(await inputsIn(page, '.target-form'));
    expect(targets.map(t => t.placeholder)).toEqual(expect.arrayContaining(['Goal Duration (MM:SS)', 'Goal Distance', 'Goal Pace (MM:SS per mile)']));
    await page.getByPlaceholder('Goal Duration (MM:SS)').pressSequentially('130');
    await expect(page.getByPlaceholder('Goal Duration (MM:SS)')).toHaveValue('1:30');
  });
});
