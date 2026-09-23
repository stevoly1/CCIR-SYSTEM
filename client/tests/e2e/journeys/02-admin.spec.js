import { expect, test } from '@playwright/test';
import { loginAs } from '../support/session';

test('J2 administrator triages, assigns, reassigns, unassigns, and deletes spam', async ({ page }) => {
  await loginAs(page, 'citizen@e2e.test');
  for (const description of ['Deep pothole at the Allen junction', 'Buy cheap watches now spam spam']) {
    await page.goto('/dashboard/report');
    await page.getByLabel("What's the issue?").fill(description);
    await page.getByLabel('Location').fill('Allen junction, Ikeja');
    await page.getByRole('button', { name: 'Submit Report' }).click();
    await expect(page).toHaveURL(/\/dashboard\/reports\/[0-9a-f]{24}$/);
  }
  await page.context().clearCookies();

  await loginAs(page, 'admin@e2e.test');
  await page.goto('/dashboard/reports');
  await page.getByText('Deep pothole at the Allen junction').click();
  await page.getByLabel('Status').selectOption('IN_REVIEW');
  await page.getByLabel('Public note (visible to the reporter)').fill('Inspection scheduled');
  await page.getByRole('button', { name: 'Save update' }).click();
  await expect(page.getByLabel('Report timeline')).toContainText('Inspection scheduled');

  await page.getByLabel('Assign to').selectOption({ label: 'Ade Agency' });
  await page.getByRole('button', { name: 'Assign' }).click();
  await expect(page.getByLabel('Responsibility')).toContainText('Ade Agency');
  await page.getByLabel('Assign to').selectOption({ label: 'Bisi Agency' });
  await page.getByLabel('Assignment reason (optional)').fill('Closer crew');
  await page.getByRole('button', { name: 'Reassign' }).click();
  await expect(page.getByLabel('Assignment history')).toContainText('Closer crew');
  await page.getByRole('button', { name: 'Unassign' }).click();
  await page.getByRole('button', { name: 'Confirm unassign' }).click();
  await expect(page.getByLabel('Responsibility')).toContainText('Not assigned');
  await page.getByLabel('Assign to').selectOption({ label: 'Bisi Agency' });
  await page.getByRole('button', { name: 'Assign' }).click();
  await expect(page.getByLabel('Responsibility')).toContainText('Bisi Agency');

  await page.goto('/dashboard/reports');
  await page.getByText('Buy cheap watches now spam spam').click();
  await page.getByRole('button', { name: 'Delete permanently' }).click();
  await page.getByLabel('Reason (required)').fill('Spam advertisement');
  await page.getByRole('button', { name: 'Delete permanently' }).last().click();
  await expect(page).toHaveURL(/\/dashboard\/reports$/);
  await expect(page.getByText('Buy cheap watches now spam spam')).toHaveCount(0);
});

test('J3 administrator manages categories', async ({ page }) => {
  await loginAs(page, 'admin@e2e.test');
  await page.goto('/dashboard/categories');
  await page.getByLabel('Name').first().fill('Bridges');
  await page.getByRole('button', { name: 'Add category' }).click();
  await expect(page.getByRole('row', { name: 'Bridges' })).toBeVisible();

  await page.getByLabel('Name').first().fill('  BRIDGES ');
  await page.getByRole('button', { name: 'Add category' }).click();
  await expect(page.getByRole('alert')).toContainText('A category with this name already exists');

  await page.getByRole('button', { name: 'Edit Bridges' }).click();
  await page.getByLabel('Description').last().fill('Footbridges and overpasses');
  await page.getByRole('button', { name: 'Save category' }).click();
  await expect(page.getByRole('row', { name: 'Bridges' })).toContainText('Footbridges and overpasses');

  await page.getByRole('button', { name: 'Deactivate Bridges' }).click();
  await page.getByRole('button', { name: 'Confirm deactivate' }).click();
  await page.getByRole('button', { name: 'Activate Bridges' }).click();
  await page.getByRole('button', { name: 'Confirm activate' }).click();
  await page.getByRole('button', { name: 'Deactivate Bridges' }).click();
  await page.getByRole('button', { name: 'Confirm deactivate' }).click();
  await page.getByRole('button', { name: 'Delete Bridges' }).click();
  await page.getByRole('button', { name: 'Confirm delete' }).click();
  await expect(page.getByRole('row', { name: 'Bridges' })).toHaveCount(0);

  // Roads holds J2's report, so even when inactive it is never offered for deletion.
  const roads = page.getByRole('row', { name: 'Roads' });
  await page.getByRole('button', { name: 'Deactivate Roads' }).click();
  await page.getByRole('button', { name: 'Confirm deactivate' }).click();
  await expect(roads).toContainText('Inactive');
  await expect(page.getByRole('button', { name: 'Delete Roads' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Activate Roads' }).click();
  await page.getByRole('button', { name: 'Confirm activate' }).click();
  await expect(page.getByRole('button', { name: 'Deactivate Roads' })).toBeVisible();

  await expect(page.getByRole('row', { name: 'Other' })).toContainText('System fallback');
  await expect(page.getByRole('row', { name: 'Other' }).getByRole('button')).toHaveCount(0);
});
