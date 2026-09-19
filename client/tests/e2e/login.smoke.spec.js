import { expect, test } from '@playwright/test';

test('an unauthenticated visitor can reach the login form without a backend', async ({ page }) => {
  await page.route('**/api/v1/users/profile', async (route) => {
    await route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Authentication required' }),
    });
  });

  await page.goto('/login');

  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await expect(page.getByLabel('Email')).toBeVisible();
  await expect(page.getByLabel('Password')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible();
});
