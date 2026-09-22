import { expect } from '@playwright/test';

export const PASSWORD = 'E2e-password-1';

export const loginAs = async (page, email) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
};
