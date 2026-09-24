import { expect, test } from '@playwright/test';

// The page is served by the API itself (the e2e API server), not by the reference client.
test('the API documentation page renders the contract without security-policy errors', async ({ page }) => {
  const problems = [];
  page.on('console', (message) => {
    if (/Content Security Policy|Refused to/i.test(message.text())) problems.push(message.text());
  });
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));

  await page.goto('http://127.0.0.1:8181/api/v1/docs');
  await expect(page.getByRole('heading', { name: /CCIR API/ })).toBeVisible();
  await expect(page.getByText('/complaints/{id}/withdraw', { exact: true })).toBeVisible();
  expect(problems).toEqual([]);
});
