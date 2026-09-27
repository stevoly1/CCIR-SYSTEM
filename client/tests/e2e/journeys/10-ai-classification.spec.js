import { expect, test } from '@playwright/test';
import { loginAs } from '../support/session';
import { latestLink, tokenOf } from '../support/outbox';

const API = 'http://127.0.0.1:8181/api/v1';
const ORIGIN = 'http://127.0.0.1:4173';
const PASSWORD = 'Start-pass-1';
const unique = (prefix) => `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@e2e.test`;
const pathOf = (url) => new URL(url).pathname;
const category = (page) => page.getByRole('heading', { name: 'Category' }).locator('xpath=following-sibling::*[1]');

const verifiedCitizen = async (page, name) => {
  const email = unique('j4c-ai');
  const signup = await page.request.post(`${API}/auth/signup`, { headers: { Origin: ORIGIN }, data: { name, email, password: PASSWORD } });
  expect(signup.ok()).toBe(true);
  const token = tokenOf(await latestLink(email, 'verify_email'));
  const verification = await page.request.post(`${API}/auth/email/verify`, { headers: { Origin: ORIGIN }, data: { token } });
  expect(verification.ok()).toBe(true);
};

const fileReport = async (page, description, chosenCategory) => {
  await page.goto('/dashboard/report');
  await page.getByLabel("What's the issue?").fill(description);
  if (chosenCategory) await page.getByLabel('Category (optional)').selectOption({ label: chosenCategory });
  await page.getByLabel('Location').fill('Market');
  await page.getByRole('button', { name: /12 Market Road/ }).click();
  await page.getByRole('button', { name: 'Submit Report' }).click();
  await expect(page).toHaveURL(/\/dashboard\/reports\/[0-9a-f]{24}$/);
  return pathOf(page.url());
};

const staffPage = async (browser) => {
  const context = await browser.newContext({ baseURL: ORIGIN });
  const page = await context.newPage();
  await loginAs(page, 'admin@e2e.test');
  return { context, page };
};

test('J-4c-5 a report is classified in the background; staff see the AI details', async ({ page, browser }) => {
  await verifiedCitizen(page, 'Kemi Classify');
  const url = await fileReport(page, 'A pothole slowly widening on the road by the market');
  await expect(page.getByRole('status').filter({ hasText: 'Classifying…' })).toBeVisible();
  await expect(category(page)).toHaveText('Roads', { timeout: 15000 });

  const staff = await staffPage(browser);
  await staff.page.goto(url);
  const details = staff.page.locator('.field', { has: staff.page.getByRole('heading', { name: 'AI details' }) });
  await expect(details.getByText('Suggested Roads (90%)')).toBeVisible();
  await expect(details.getByText('kimi · kimi-e2e · prompt classify-v1')).toBeVisible();
  await staff.context.close();
});

test("J-4c-6 a citizen's category stands; staff use the AI's when it disagrees", async ({ page, browser }) => {
  await verifiedCitizen(page, 'Tobi Chooser');
  const url = await fileReport(page, 'A deep pothole outside the clinic gate', 'Drainage');
  await expect(category(page)).toHaveText('Drainage');

  const staff = await staffPage(browser);
  await staff.page.goto('/dashboard/reports');
  await staff.page.getByLabel('Filter by AI state').selectOption({ label: 'AI disagrees' });
  await staff.page.locator('.complaint-card', { hasText: 'pothole outside the clinic gate' }).click();
  const panel = staff.page.getByRole('region', { name: 'AI disagreement' });
  await expect(panel).toContainText('AI suggests Roads (90%)');
  await panel.getByRole('button', { name: "Use AI's category" }).click();
  const dialog = staff.page.getByRole('dialog', { name: "Use the AI's category" });
  await expect(dialog.getByLabel('Category')).toHaveValue(/.+/);
  await dialog.getByLabel('Reason (staff only)').fill('The photo and text describe the road surface');
  await dialog.getByRole('button', { name: 'Save category' }).click();
  await expect(staff.page.getByText('Category changed from Drainage to Roads')).toBeVisible();
  await expect(panel).toHaveCount(0);

  await page.goto(url);
  await expect(category(page)).toHaveText('Roads');
  await expect(page.getByText('Category changed')).toHaveCount(0);
  await expect(page.getByText('The photo and text describe the road surface')).toHaveCount(0);
  await staff.context.close();
});

test('J-4c-7 a classification the AI refused shows as failed; an administrator re-runs it', async ({ page, browser }) => {
  await verifiedCitizen(page, 'Lanre Refused');
  const url = await fileReport(page, 'Streetlight refuse-once broken near the junction');

  const staff = await staffPage(browser);
  await staff.page.goto(url);
  await expect(staff.page.getByRole('note')).toContainText('AI classification failed. The AI declined this report.', { timeout: 15000 });
  await staff.page.goto('/dashboard/jobs');
  await staff.page.getByRole('tab', { name: 'AI', exact: true }).click();
  await expect(staff.page.getByRole('row', { name: /Report classification.*The AI declined the report/ })).toBeVisible();

  await staff.page.goto('/dashboard/reports');
  await staff.page.getByLabel('Filter by AI state').selectOption({ label: 'AI failed' });
  await staff.page.locator('.complaint-card', { hasText: 'refuse-once broken near the junction' }).click();
  await staff.page.getByRole('button', { name: 'Re-run AI' }).click();
  await expect(category(staff.page)).toHaveText('Streetlights', { timeout: 15000 });

  await staff.page.goto('/dashboard/jobs');
  await staff.page.getByRole('tab', { name: 'AI', exact: true }).click();
  await expect(staff.page.getByText('No failed jobs.')).toBeVisible();
  await staff.context.close();
});

test('J-4c-8 staff re-categorise a report with a reason; the AI does not change it back', async ({ page, browser }) => {
  await verifiedCitizen(page, 'Musa Recategorise');
  const url = await fileReport(page, 'Water flooding the road after the rain');
  const id = url.split('/').pop();
  await expect(category(page)).toHaveText('Roads', { timeout: 15000 });

  const staff = await staffPage(browser);
  await staff.page.goto(url);
  await staff.page.getByRole('button', { name: 'Re-categorise' }).click();
  const dialog = staff.page.getByRole('dialog', { name: 'Re-categorise' });
  await dialog.getByLabel('Category').selectOption({ label: 'Drainage' });
  await dialog.getByLabel('Reason (staff only)').fill('Standing water is a drainage fault');
  await dialog.getByRole('button', { name: 'Save category' }).click();
  await expect(staff.page.getByText('Category changed from Roads to Drainage')).toBeVisible();

  await staff.page.getByRole('button', { name: 'Re-run AI' }).click();
  await expect.poll(async () => {
    const { complaint } = await (await staff.page.request.get(`${API}/complaints/${id}`)).json();
    return `${complaint.ai.status}:${complaint.ai.requestSeq}:${complaint.ai.suggestedCategory}`;
  }, { timeout: 15000 }).toBe('DONE:2:Roads');
  await staff.page.reload();
  await expect(category(staff.page)).toHaveText('Drainage');
  await staff.context.close();
});
