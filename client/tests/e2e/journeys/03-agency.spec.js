import { expect, test } from '@playwright/test';
import { loginAs } from '../support/session';

test('J4 assigned agency user progresses a report; unassigned reports are read-only', async ({ page }) => {
  await loginAs(page, 'agency-b@e2e.test');
  await page.goto('/dashboard/reports');
  await page.getByRole('button', { name: 'Assigned to me' }).click();
  await page.getByText('Deep pothole at the Allen junction').click();

  await page.getByLabel('Status').selectOption('IN_PROGRESS');
  await page.getByLabel('Public note (visible to the reporter)').fill('Crew on site');
  await page.getByLabel('Internal note (staff only)').fill('INTERNAL-J4 contractor ref 42');
  await page.getByRole('button', { name: 'Save update' }).click();
  await expect(page.getByLabel('Report timeline')).toContainText('INTERNAL-J4 contractor ref 42');

  await page.getByLabel('Priority').selectOption('CRITICAL');
  await page.getByRole('button', { name: 'Save update' }).click();
  await expect(page.getByLabel('Report timeline')).toContainText('Priority changed from High to Critical');

  await page.getByLabel('Status').selectOption('RESOLVED');
  await page.getByLabel('Public note (visible to the reporter)').fill('Repaired and resurfaced');
  await page.getByRole('button', { name: 'Save update' }).click();
  await expect(page.getByLabel('Report timeline')).toContainText('Repaired and resurfaced');

  await page.context().clearCookies();
  await loginAs(page, 'agency-a@e2e.test');
  await page.goto('/dashboard/reports');
  await page.getByText('Deep pothole at the Allen junction').click();
  await expect(page.getByText('Only the assigned staff member can update this report.')).toBeVisible();
});
