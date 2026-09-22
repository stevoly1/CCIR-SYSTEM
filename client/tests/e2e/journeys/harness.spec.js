import { expect, test } from '@playwright/test';
import { loginAs } from '../support/session';

test('each seeded role can sign in against the real API', async ({ page }) => {
  for (const [email, reportsLink] of [
    ['citizen@e2e.test', 'My Reports'],
    ['agency-a@e2e.test', 'All Reports'],
    ['admin@e2e.test', 'All Reports'],
  ]) {
    await loginAs(page, email);
    await expect(page.getByRole('link', { name: reportsLink })).toBeVisible();
    await page.context().clearCookies();
  }
});
