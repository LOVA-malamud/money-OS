import { expect, test, type Page } from '@playwright/test';
const fixture = 'http://127.0.0.1:54321';
async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('סיסמה', { exact: true }).fill('local-only-passphrase');
  await page.getByRole('button', { name: 'כניסה לחשבון', exact: true }).click();
  await expect(page.getByRole('navigation')).toBeVisible();
}
async function nav(page: Page, name: string) {
  await page.getByRole('navigation').getByRole('button', { name, exact: true }).click();
}
test.beforeEach(async ({ request }) => {
  expect(await (await request.get(`${fixture}/health`)).json()).toMatchObject({ testOnly: true });
  expect((await request.post(`${fixture}/__test/reset`, { headers: { 'x-lova-test-key': 'local-fixture-only' }, data: { seed: true } })).ok()).toBeTruthy();
});
test('existing types are immutable, including unopened accounts; creation still selects types', async ({ page }) => {
  await login(page); await nav(page, 'הכסף שלי');
  await page.getByRole('button', { name: 'עריכת החשבון שלי', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'סוג החשבון', exact: true })).toBeDisabled();
  await expect(page.getByText('סוג החשבון נקבע בעת יצירתו ואינו ניתן לשינוי.')).toBeVisible();
  await page.getByRole('button', { name: 'סגירה', exact: true }).click();
  await page.getByRole('button', { name: 'חשבון', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'סוג החשבון', exact: true })).toBeEnabled();
  await page.getByRole('combobox', { name: 'סוג החשבון', exact: true }).selectOption('savings');
  await page.getByLabel('שם', { exact: true }).fill('חיסכון ללא פתיחה');
  await page.getByRole('button', { name: 'הוספה', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'יתרה התחלתית', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'סגירה', exact: true }).click();
  await page.getByRole('button', { name: 'עריכת חיסכון ללא פתיחה', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'סוג החשבון', exact: true })).toBeDisabled();
  await expect(page.getByRole('combobox', { name: 'סוג החשבון', exact: true })).toHaveValue('savings');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'הגדרות וגיבוי', exact: true }).click();
  await page.getByRole('button', { name: 'עריכת קטגוריה דלק', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'סוג', exact: true })).toBeDisabled();
  await expect(page.getByText('סוג הקטגוריה נקבע בעת יצירתה ואינו ניתן לשינוי.')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'קטגוריה', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'סוג', exact: true })).toBeEnabled();
  await page.getByRole('combobox', { name: 'סוג', exact: true }).selectOption('income');
  await page.getByLabel('שם', { exact: true }).fill('הכנסה לבדיקה');
  await page.getByRole('button', { name: 'הוספה', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.getByRole('button', { name: 'עריכת קטגוריה הכנסה לבדיקה', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'סוג', exact: true })).toHaveValue('income');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
});
test('dirty recurrence guards X, Escape and backdrop; continue retains fields and save clears guard', async ({ page }) => {
  await login(page); await nav(page, 'התחייבויות');
  await page.getByRole('tab', { name: 'קבועים', exact: true }).click();
  await page.getByRole('button', { name: 'התחייבות', exact: true }).click();
  await page.getByLabel('שם', { exact: true }).fill('ביטוח בדיקה');
  await page.getByLabel('סכום צפוי בשקלים', { exact: true }).fill('123');
  for (const method of ['close', 'escape', 'backdrop']) {
    if (method === 'close') await page.getByRole('button', { name: 'סגירה', exact: true }).click();
    else if (method === 'escape') await page.keyboard.press('Escape');
    else await page.locator('.sheet-overlay').dispatchEvent('mousedown');
    await expect(page.getByRole('group', { name: 'שינויים שלא נשמרו' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'המשך עריכה', exact: true })).toBeFocused();
    await page.getByRole('button', { name: 'המשך עריכה', exact: true }).click();
    await expect(page.getByLabel('שם', { exact: true })).toHaveValue('ביטוח בדיקה');
    await expect(page.getByLabel('סכום צפוי בשקלים', { exact: true })).toHaveValue('123');
  }
  await page.getByRole('button', { name: 'הוספה', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.getByRole('button', { name: 'עריכת ביטוח בדיקה', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
});
test('discard is explicit, reverted fields close normally and entity state never leaks', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await login(page); await nav(page, 'הכסף שלי');
  await page.getByRole('button', { name: 'עריכת החשבון שלי', exact: true }).click();
  await page.getByLabel('שם', { exact: true }).fill('לא לשמור');
  await page.keyboard.press('Escape');
  await page.addStyleTag({ content: 'html {font-size:200%}' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  const discard = page.getByRole('button', { name: 'יציאה ללא שמירה', exact: true });
  await discard.scrollIntoViewIfNeeded();
  const bounds = await discard.boundingBox();
  expect(bounds!.height).toBeGreaterThanOrEqual(44);
  await discard.click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.getByRole('button', { name: 'עריכת חיסכון', exact: true }).click();
  await expect(page.getByLabel('שם', { exact: true })).toHaveValue('חיסכון');
  await page.getByLabel('שם', { exact: true }).fill('שינוי זמני');
  await page.getByLabel('שם', { exact: true }).fill('חיסכון');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.getByRole('button', { name: 'עריכת החשבון שלי', exact: true }).click();
  await expect(page.getByLabel('שם', { exact: true })).toHaveValue('החשבון שלי');
});
