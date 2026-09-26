import { expect, test } from '@playwright/test';
import { loginAs } from '../support/session';
import { latestLink, latestMessage } from '../support/outbox';

const API = 'http://127.0.0.1:8181/api/v1';
const ORIGIN = 'http://127.0.0.1:4173';
const PASSWORD = 'Start-pass-1';
const unique = (prefix) => `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@e2e.test`;

// The queue group runs against its own server, so its sign-ins (two, both the administrator's) have
// their own limit. A fresh account signs up through `api`; with page.request the browser is signed
// in without spending a sign-in.
const signUp = async (api, name, email) => {
  const response = await api.post(`${API}/auth/signup`, { headers: { Origin: ORIGIN }, data: { name, email, password: PASSWORD } });
  expect(response.ok()).toBe(true);
};

test('J-4c-1 a new account verifies its email before it can report', async ({ page }) => {
  const email = unique('j4c1');
  await page.goto('/signup');
  await page.getByLabel('Full name').fill('Vera Verify');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole('region', { name: 'Email verification' })).toContainText(`We sent a link to ${email}`);

  await page.goto('/dashboard/report');
  await expect(page.getByRole('button', { name: 'Submit Report' })).toHaveCount(0);

  await page.goto(await latestLink(email, 'verify_email'));
  await expect(page).toHaveURL(/\/verify-email$/); // the token left the address bar
  await page.getByRole('button', { name: 'Verify my email address' }).click();
  await expect(page.getByText('Your email address is verified. You can now report issues.')).toBeVisible();

  await page.goto('/dashboard/report');
  await expect(page.getByRole('region', { name: 'Email verification' })).toHaveCount(0);
  await page.getByLabel("What's the issue?").fill('Streetlight out on the verified road');
  await page.getByLabel('Location').fill('Market');
  await page.getByRole('button', { name: /12 Market Road/ }).click();
  await page.getByRole('button', { name: 'Submit Report' }).click();
  await expect(page).toHaveURL(/\/dashboard\/reports\/[0-9a-f]{24}$/);
  // Sent by the worker, to the address the account proved.
  await latestMessage(email, 'report_filed');
});

test('J-4c-2 an administrator sees an unverified account and cannot make it staff', async ({ page, request }) => {
  const email = unique('j4c2');
  await signUp(request, 'Newt Unverified', email);
  await loginAs(page, 'admin@e2e.test');
  await page.goto('/dashboard/users');
  await page.getByRole('textbox', { name: 'Search users' }).fill(email);
  const row = page.locator('.user-row', { hasText: 'Newt Unverified' });
  await expect(row.getByText('Email not verified')).toBeVisible();
  await row.getByRole('button', { name: 'Edit user', exact: true }).click();
  const role = page.getByLabel('Role', { exact: true });
  await expect(role.getByRole('option', { name: 'agency' })).toBeDisabled();
  await expect(role.getByRole('option', { name: 'admin' })).toBeDisabled();
  await expect(page.getByText("Verify this account's email address before giving it a staff role.")).toBeVisible();
});

test('J-4c-3 an email change whose notice fails is retried from the Jobs page and completes', async ({ page, browser }) => {
  const email = unique('fail-once-j4c3');
  const newEmail = unique('j4c3-new');
  await signUp(page.request, 'Faye Failure', email);

  await page.goto('/dashboard/profile');
  await page.getByLabel('New email address').fill(newEmail);
  await page.getByLabel('Your password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Send confirmation link' }).click();
  // The notice fails once (the provider is "down"); the form shows it as the profile updates.
  await expect(page.getByText(`We couldn't send the email for the change to ${newEmail}. Try again.`)).toBeVisible({ timeout: 20000 });

  const adminContext = await browser.newContext({ baseURL: ORIGIN });
  const admin = await adminContext.newPage();
  await loginAs(admin, 'admin@e2e.test');
  await admin.goto('/dashboard/jobs');
  const row = admin.locator('tr', { hasText: 'Faye Failure' });
  await expect(row.getByText('Email change notice')).toBeVisible();
  await expect(row.getByText('Email provider unavailable')).toBeVisible();
  await row.getByRole('button', { name: 'Retry' }).click();
  await expect(admin.getByText('Queued again')).toBeVisible();
  await expect(admin.locator('tr', { hasText: 'Faye Failure' })).toHaveCount(0);
  await adminContext.close();

  // The old address is told first, then the link goes to the new one.
  await latestMessage(email, 'email_change_notice');
  await page.reload();
  await expect(page.getByText(`Check your new inbox at ${newEmail}. Your address changes when you open the link; it expires in 24 hours.`)).toBeVisible({ timeout: 20000 });
  await page.goto(await latestLink(newEmail, 'email_change_confirmation'));
  await page.getByRole('button', { name: 'Confirm new email address' }).click();
  await expect(page.getByText('Your email address has been changed.')).toBeVisible();
});
