import { expect, test } from '@playwright/test';
import { loginAs } from '../support/session';

test('J5 citizen sees a resolved timeline without staff identities and cannot open admin pages', async ({ page }) => {
  await loginAs(page, 'citizen@e2e.test');
  await page.goto('/dashboard/reports?status=RESOLVED');
  await page.getByText('Deep pothole at the Allen junction').click();
  const timeline = page.getByLabel('Report timeline');
  await expect(timeline).toContainText('Repaired and resurfaced');
  await expect(timeline).toContainText('Agency staff');
  await expect(page.locator('body')).not.toContainText(/Bisi Agency|Chi Admin|INTERNAL-J4/);
  await page.goto('/dashboard/categories');
  await expect(page).not.toHaveURL(/categories/);
});
