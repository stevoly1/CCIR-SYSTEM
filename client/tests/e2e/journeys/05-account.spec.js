import { expect, test } from '@playwright/test';

const API = 'http://127.0.0.1:8181/api/v1';

test('J6 citizen signs up, edits the profile, logs out, is locked out, and logs back in', async ({ page, context }) => {
  const email = `j6-${Date.now()}@e2e.test`;
  const password = 'J6-password-1';

  // The browser itself refuses a password under six characters (jsdom cannot show this).
  await page.goto('/signup');
  await page.getByLabel('Full name').fill('Jola Journey');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('short');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/signup$/);
  expect(await page.getByLabel('Password').evaluate((input) => input.validity.tooShort)).toBe(true);

  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  await page.goto('/dashboard/profile');
  await expect(page.getByLabel('Full name')).toHaveValue('Jola Journey');
  await expect(page.getByLabel('Email')).toHaveValue(email);
  await page.getByLabel('Full name').fill('Jola Journey-Edited');
  await page.getByLabel('Phone').fill('+2348000000000');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Profile updated')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Full name')).toHaveValue('Jola Journey-Edited');
  await expect(page.getByLabel('Phone')).toHaveValue('+2348000000000');

  const cookiesBeforeLogout = await context.cookies();
  expect(cookiesBeforeLogout.map((cookie) => cookie.name)).toEqual(expect.arrayContaining(['accessToken', 'refreshToken']));
  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page).toHaveURL(/\/login/);
  expect((await context.cookies()).map((cookie) => cookie.name)).not.toContain('refreshToken');

  await page.goto('/dashboard/reports');
  await expect(page).toHaveURL(/\/login/);

  // Logout revoked the refresh token on the server, so replaying the old cookie must fail.
  // (Access tokens are stateless and expire after ACCESS_TOKEN_LIFESPAN: a documented limit.)
  await context.addCookies(cookiesBeforeLogout.filter((cookie) => cookie.name === 'refreshToken'));
  const replay = await page.request.get(`${API}/users/profile`);
  expect(replay.status()).toBe(401);
  await context.clearCookies();

  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await page.goto('/dashboard/profile');
  await expect(page.getByLabel('Full name')).toHaveValue('Jola Journey-Edited');
});
