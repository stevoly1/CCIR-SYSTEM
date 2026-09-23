import { expect, test } from '@playwright/test';
import { loginAs } from '../support/session';

// Journeys share one seeded server and run in file order (workers: 1, fullyParallel: false):
// 01 citizen core → 02 administrator → 03 agency → 04 citizen review.

const fileReport = async (page, description, { suggestion = true } = {}) => {
  await page.goto('/dashboard/report');
  await page.getByLabel("What's the issue?").fill(description);
  if (suggestion) {
    await page.getByLabel('Location').fill('Market');
    await page.getByRole('button', { name: /12 Market Road/ }).click();
  }
  await page.getByRole('button', { name: 'Submit Report' }).click();
  await expect(page).toHaveURL(/\/dashboard\/reports\/[0-9a-f]{24}$/);
};

test('J1 citizen reports, edits, and withdraws', async ({ page }) => {
  await loginAs(page, 'citizen@e2e.test');
  await fileReport(page, 'Large pothole on the market road damaging tyres');
  await expect(page.getByText('Awaiting assignment')).toBeVisible();
  await expect(page.getByLabel('Report timeline')).toContainText('Report submitted');
  await expect(page.getByText('Precise position recorded')).toBeVisible();

  await page.getByRole('button', { name: 'Edit report' }).click();
  // No 'road' here: the fake AI matches /pothole|road/ before /drain|flood/.
  await page.getByLabel('Description').fill('Blocked drain flooding the market lane after rain');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Your report was re-analysed')).toBeVisible();
  await expect(page.getByText('Drainage')).toBeVisible();

  await page.getByRole('button', { name: 'Edit report' }).click();
  await page.getByLabel('Location').fill('Opposite the market gate, Ikeja');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Precise position recorded')).toHaveCount(0);

  await fileReport(page, 'Streetlight out beside the bus shelter');
  await page.getByRole('button', { name: 'Withdraw report' }).click();
  await page.getByLabel(/reason/i).fill('Fixed this morning');
  await page.getByRole('button', { name: /^withdraw$/i }).click();
  await expect(page.getByLabel('Report timeline')).toContainText('Fixed this morning');
  await expect(page.getByRole('button', { name: 'Edit report' })).toHaveCount(0);
});

test('J1-D degraded location paths still allow reporting', async ({ page, context }) => {
  await loginAs(page, 'citizen2@e2e.test');

  await page.goto('/dashboard/report');
  await page.getByRole('button', { name: 'Use my current location' }).click();
  await expect(page.getByText(/permission was denied|could not be found/)).toBeVisible();
  await page.getByLabel("What's the issue?").fill('Waste pile blocking the pavement near school');
  await page.getByLabel('Location').fill('Near the primary school, Yaba');
  await page.getByRole('button', { name: 'Submit Report' }).click();
  await expect(page).toHaveURL(/\/dashboard\/reports\//);

  await page.route('**/api/v1/location/autocomplete**', (route) => route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({ error: { code: 'LOCATION_PROVIDER_UNAVAILABLE', message: 'Location lookup is temporarily unavailable' } }),
  }));
  await page.goto('/dashboard/report');
  await page.getByLabel('Location').fill('Market square');
  await expect(page.getByText('Suggestions unavailable — type the address')).toBeVisible();
  await page.getByLabel("What's the issue?").fill('Broken bench in the market square');
  await page.getByRole('button', { name: 'Submit Report' }).click();
  await expect(page).toHaveURL(/\/dashboard\/reports\//);
  await page.unroute('**/api/v1/location/autocomplete**');

  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 9.999, longitude: 3.3 });
  await page.goto('/dashboard/report');
  await page.getByRole('button', { name: 'Use my current location' }).click();
  await expect(page.getByText('Position saved — please type a nearby address or landmark.')).toBeVisible();
  await expect(page.getByLabel('Location')).toHaveValue('');
});
