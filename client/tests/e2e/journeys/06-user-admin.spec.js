import { expect, test } from '@playwright/test';
import { loginAs, PASSWORD } from '../support/session';

// exact: true throughout: a loose "Delete" also matches every "Delete user" button (see J3).
test('J7 administrator edits and retires a user; the retired user cannot sign in', async ({ page, browser }) => {
  await loginAs(page, 'admin@e2e.test');
  await page.goto('/dashboard/users');
  const rowFor = (text) => page.locator('.user-row', { hasText: text });

  await expect(rowFor('retiree@e2e.test')).toContainText('Remi Retiree');
  await rowFor('retiree@e2e.test').getByRole('button', { name: 'Edit user', exact: true }).click();
  await expect(page.getByLabel('Email')).toHaveValue('retiree@e2e.test');
  await page.getByLabel('Full name').fill('Remi Retiree-Renamed');
  await page.getByLabel('Role', { exact: true }).selectOption('agency');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByText('User updated')).toBeVisible();
  await expect(rowFor('retiree@e2e.test')).toContainText('Remi Retiree-Renamed');
  await expect(rowFor('retiree@e2e.test')).toContainText('agency');

  // The page reflects the server, not just local state.
  await page.reload();
  await expect(rowFor('retiree@e2e.test')).toContainText('Remi Retiree-Renamed');
  await expect(rowFor('retiree@e2e.test')).toContainText('agency');

  const own = rowFor('admin@e2e.test');
  await expect(own.getByRole('button', { name: 'Delete user', exact: true })).toBeDisabled();

  await rowFor('retiree@e2e.test').getByRole('button', { name: 'Delete user', exact: true }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(rowFor('retiree@e2e.test')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.user-row', { hasText: 'Retired account' })).toHaveCount(1);
  await expect(rowFor('retiree@e2e.test')).toHaveCount(0);

  const otherContext = await browser.newContext();
  const other = await otherContext.newPage();
  await other.goto('/login');
  await other.getByLabel('Email').fill('retiree@e2e.test');
  await other.getByLabel('Password').fill(PASSWORD);
  await other.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(other.getByText('Invalid email or password')).toBeVisible();
  await expect(other).toHaveURL(/\/login/);
  await otherContext.close();
});
