import { expect, test } from '@playwright/test';
import { loginAs } from '../support/session';
import { latestLink, latestMessage } from '../support/outbox';

const API = 'http://127.0.0.1:8181/api/v1';
const ORIGIN = 'http://127.0.0.1:4173';
let counter = 0;

// Every sign-in counts against one limit per address (20 in 15 minutes), and all journeys come from
// 127.0.0.1 to one server per browser run. So these journeys sign in only where the sign-in is what
// they prove: a fresh account signs up through `api`, and when `api` is the page's own request
// context (page.request), the browser is signed in without spending a sign-in.
const newAccount = async (api, name) => {
  counter += 1;
  const email = `j4b-${Date.now()}-${counter}@e2e.test`;
  const password = 'Start-pass-1';
  const response = await api.post(`${API}/auth/signup`, { headers: { Origin: ORIGIN }, data: { name, email, password } });
  expect(response.ok()).toBe(true);
  return { email, password };
};

const signIn = async (page, email, password) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();
};

const fileReport = async (page, description) => {
  await page.goto('/dashboard/report');
  await page.getByLabel("What's the issue?").fill(description);
  await page.getByLabel('Location').fill('Market');
  await page.getByRole('button', { name: /12 Market Road/ }).click();
  await page.getByRole('button', { name: 'Submit Report' }).click();
  await expect(page).toHaveURL(/\/dashboard\/reports\/[0-9a-f]{24}$/);
  return new URL(page.url()).pathname;
};

test('J-4b-1 forgot password, reset from the emailed link, sign in with the new password', async ({ page, request }) => {
  const { email } = await newAccount(request, 'Reset Person');
  await page.goto('/login');
  await page.getByRole('link', { name: 'Forgot password?' }).click();
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByRole('status')).toContainText(email);

  const link = await latestLink(email, 'password_reset');
  await page.goto(link);
  await expect(page).toHaveURL(/\/reset-password$/); // the token left the address bar
  await page.getByLabel('New password', { exact: true }).fill('Reset-pass-22');
  await page.getByLabel('Repeat new password').fill('Reset-pass-22');
  await page.getByRole('button', { name: 'Set new password' }).click();
  await expect(page).toHaveURL(/\/login$/);

  await signIn(page, email, 'Reset-pass-22');
  await expect(page).toHaveURL(/\/dashboard/);
  await latestMessage(email, 'password_changed');

  // The link worked once.
  await page.context().clearCookies();
  await page.goto(link);
  await page.getByLabel('New password', { exact: true }).fill('Another-pass-3');
  await page.getByLabel('Repeat new password').fill('Another-pass-3');
  await page.getByRole('button', { name: 'Set new password' }).click();
  await expect(page.getByText('This link is invalid or has expired.')).toBeVisible();
});

test('J-4b-2 changing the password signs out the other devices, not this one', async ({ page, browser }) => {
  const { email, password } = await newAccount(page.request, 'Change Person');
  const other = await browser.newContext({ baseURL: ORIGIN });
  const otherPage = await other.newPage();
  await signIn(otherPage, email, password);
  await expect(otherPage).toHaveURL(/\/dashboard/);

  await page.goto('/dashboard/profile');
  await page.getByLabel('Current password').fill(password);
  await page.getByLabel('New password', { exact: true }).fill('Changed-pass-33');
  await page.getByLabel('Repeat new password').fill('Changed-pass-33');
  await page.getByRole('button', { name: 'Change password' }).click();
  await expect(page.getByText('Password changed. Your other devices have been signed out.')).toBeVisible();

  await page.reload();
  await expect(page).toHaveURL(/\/dashboard\/profile$/);
  await expect(page.getByLabel('Current password')).toBeVisible();
  await otherPage.goto('/dashboard/profile');
  await expect(otherPage).toHaveURL(/\/login/);
  await other.close();
});

test('J-4b-3 a user changes their own email address and confirms it', async ({ page }) => {
  const { email, password } = await newAccount(page.request, 'Moving Person');
  const newEmail = `moved-${Date.now()}@e2e.test`;
  await page.goto('/dashboard/profile');
  await page.getByLabel('New email address').fill(newEmail);
  await page.getByLabel('Your password').fill(password);
  await page.getByRole('button', { name: 'Send confirmation link' }).click();
  await expect(page.getByRole('status')).toContainText(newEmail);
  await latestMessage(email, 'email_change_notice');

  await page.goto(await latestLink(newEmail, 'email_change_confirmation'));
  await expect(page).toHaveURL(/\/confirm-email$/);
  await page.getByRole('button', { name: 'Confirm new email address' }).click();
  await expect(page.getByText('Your email address has been changed.')).toBeVisible();
  await page.getByRole('link', { name: 'Back to your profile' }).click();
  await expect(page.getByLabel('Email', { exact: true })).toHaveValue(newEmail);
});

test('J-4b-4 an administrator corrects an address and the user confirms it signed out', async ({ page, browser, request }) => {
  const { email } = await newAccount(request, 'Typo Person');
  const corrected = `corrected-${Date.now()}@e2e.test`;
  await loginAs(page, 'admin@e2e.test');
  await page.goto('/dashboard/users');
  await page.getByRole('textbox', { name: 'Search users' }).fill(email);
  await page.locator('.user-row', { hasText: email }).getByRole('button', { name: 'Edit user', exact: true }).click();
  await page.getByRole('button', { name: 'Change email' }).click();
  await page.getByLabel('New email address').fill(corrected);
  await page.getByRole('button', { name: 'Send confirmation' }).click();
  await expect(page.getByText(`Confirmation sent to ${corrected}.`, { exact: false })).toBeVisible();
  await page.keyboard.press('Escape');

  const userContext = await browser.newContext({ baseURL: ORIGIN });
  const userPage = await userContext.newPage();
  await userPage.goto(await latestLink(corrected, 'email_change_confirmation'));
  await userPage.getByRole('button', { name: 'Confirm new email address' }).click();
  await expect(userPage.getByText('Your email address has been changed.')).toBeVisible();
  await expect(userPage.getByRole('link', { name: 'Sign in' })).toBeVisible();
  await userContext.close();

  await page.getByRole('textbox', { name: 'Search users' }).fill(corrected);
  await expect(page.locator('.user-row', { hasText: corrected })).toBeVisible();
});

// What staff see. The page shows any retired person as "Retired account" whatever is stored, so
// this cannot tell whether the stored snapshots were scrubbed: the integration test
// account-self-deletion proves that.
test('J-4b-5 a citizen deletes their account; staff see the report without the name', async ({ page }) => {
  const { password } = await newAccount(page.request, 'Leaving Person');
  const reportPath = await fileReport(page, 'Broken streetlight near the leaving point');

  await page.goto('/dashboard/profile');
  await page.getByRole('button', { name: 'Delete account' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete your account' });
  await dialog.getByLabel('Password').fill(password);
  await dialog.getByLabel('Reason (optional)').fill('Moving away');
  await dialog.getByRole('button', { name: 'Delete my account' }).click();
  await expect(page).toHaveURL(/\/account-deleted$/);
  await expect(page.getByRole('heading', { name: 'Your account has been deleted' })).toBeVisible();

  await loginAs(page, 'admin@e2e.test');
  await page.goto(reportPath);
  await expect(page.getByText('Reported by Retired account')).toBeVisible();
  await expect(page.getByText('Leaving Person')).toHaveCount(0);
});

test('J-4b-6 a report link opened while signed out returns there after Google sign-in', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('link', { name: /continue with google/i }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  const reportPath = await fileReport(page, 'Pothole outside the Google test house');

  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto(reportPath);
  await expect(page).toHaveURL(/\/login/);
  await page.getByRole('link', { name: /continue with google/i }).click();
  await expect(page).toHaveURL(new RegExp(`${reportPath}$`));
});
