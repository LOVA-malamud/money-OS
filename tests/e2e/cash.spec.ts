import { expect, test, type Page } from '@playwright/test';
import type { Dataset } from '../../src/domain/types';
import { accountBalance, dashboard } from '../../src/domain/reports';

const fixture = 'http://127.0.0.1:54321';
const tokens = new WeakMap<Page, string>();
async function snapshot(page: Page): Promise<Dataset> {
  const response = await page.request.post(`${fixture}/rest/v1/rpc/get_dataset`, { headers: { Authorization: `Bearer ${tokens.get(page)}` }, data: {} });
  expect(response.ok()).toBeTruthy(); return response.json();
}
async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('דוא״ל', { exact: true }).fill('owner@lova.test');
  await page.getByLabel('סיסמה', { exact: true }).fill('local-only-passphrase');
  const session = page.waitForResponse(response => response.url().includes('/auth/v1/token') && response.status() === 200);
  await page.getByRole('button', { name: 'כניסה לחשבון', exact: true }).click();
  tokens.set(page, (await (await session).json()).access_token);
  await expect(page.getByRole('navigation')).toBeVisible();
}
async function nav(page: Page, name: string) { await page.getByRole('navigation').getByRole('button', { name, exact: true }).click(); }

test('new Cash wallet stays unknown until its physical opening is explicitly entered', async ({ page, request }) => {
  await request.post(`${fixture}/__test/reset`, { headers: { 'x-lova-test-key': 'local-fixture-only' }, data: { seed: false } });
  await login(page); await nav(page, 'הכסף שלי');
  const wallet = page.locator('.list-row').filter({ has: page.getByRole('heading', { name: 'מזומן', exact: true }) });
  await expect(wallet).toContainText('הכסף הפיזי בארנק');
  expect((await snapshot(page)).transactions).toHaveLength(0);
  await wallet.getByRole('button', { name: 'הוספת כסף', exact: true }).click();
  await page.getByRole('button', { name: 'כסף שכבר בארנק · יתרת פתיחה', exact: true }).click();
  const opening = page.getByRole('dialog', { name: 'יתרה התחלתית', exact: true });
  await opening.getByLabel('יתרה מעודכנת בשקלים', { exact: true }).fill('200');
  await opening.getByRole('button', { name: 'שמירה', exact: true }).click(); await expect(opening).toBeHidden();
  const data = await snapshot(page);
  expect(data.accounts.filter(account => account.kind === 'cash')).toHaveLength(1);
  expect(data.transactions.map(tx => tx.input.kind)).toEqual(['opening']);
  expect(accountBalance(data.accounts[0], data).amountMinor).toBe('20000');
});

test('Cash funding, all three expense categories, remembered source and bank deposit work on mobile', async ({ page, request }, info) => {
  await request.post(`${fixture}/__test/reset`, { headers: { 'x-lova-test-key': 'local-fixture-only' }, data: { seed: true } });
  await login(page);
  const before = await snapshot(page); const cash = before.accounts.find(account => account.kind === 'cash')!;
  await nav(page, 'הכסף שלי');
  const wallet = page.locator('.list-row').filter({ has: page.getByRole('heading', { name: 'מזומן', exact: true }) });
  await wallet.getByRole('button', { name: 'הוספת כסף', exact: true }).click();
  await page.getByRole('button', { name: 'משיכה מחשבון בנק', exact: true }).click();
  let editor = page.getByRole('dialog', { name: 'העברה בין חשבונות', exact: true });
  await expect(editor.getByRole('combobox', { name: 'אל חשבון', exact: true })).toHaveValue(cash.id);
  await editor.getByLabel('סכום בשקלים', { exact: true }).fill('100');
  await editor.getByRole('button', { name: 'שמירה', exact: true }).click(); await expect(editor).toBeHidden();
  const transferred = await snapshot(page);
  expect(dashboard(transferred).available).toEqual(dashboard(before).available);
  expect(dashboard(transferred).income).toEqual(dashboard(before).income);
  expect(dashboard(transferred).spending).toEqual(dashboard(before).spending);
  for (const name of ['דלק', 'וויד', 'אטנט']) {
    await page.getByRole('button', { name: 'הוספת הוצאה', exact: true }).click();
    editor = page.getByRole('dialog', { name: 'הוצאה חדשה', exact: true });
    const source = editor.getByRole('combobox', { name: 'חשבון / אמצעי תשלום', exact: true });
    if (name === 'דלק') await source.selectOption(`account:${cash.id}`);
    else await expect(source).toHaveValue(`account:${cash.id}`);
    await editor.getByLabel('סכום בשקלים', { exact: true }).fill('12.90');
    await editor.getByRole('button', { name: 'כל הקטגוריות', exact: true }).click();
    await expect(editor.getByRole('button', { name, exact: true })).toHaveCount(1);
    await editor.getByRole('button', { name, exact: true }).click();
    if (name === 'דלק') await page.screenshot({ path: info.outputPath('cash-expense.png') });
    await editor.getByRole('button', { name: 'שמירת הוצאה', exact: true }).click(); await expect(editor).toBeHidden();
  }
  expect(accountBalance(cash.id, await snapshot(page)).amountMinor).toBe('6130');
  await wallet.getByRole('button', { name: 'הפקדה לבנק', exact: true }).click();
  editor = page.getByRole('dialog', { name: 'העברה בין חשבונות', exact: true });
  await editor.getByLabel('סכום בשקלים', { exact: true }).fill('10');
  await editor.getByRole('button', { name: 'שמירה', exact: true }).click(); await expect(editor).toBeHidden();
  const after = await snapshot(page);
  expect(accountBalance(cash.id, after).amountMinor).toBe('5130');
  expect(BigInt(dashboard(before).available.amountMinor!) - BigInt(dashboard(after).available.amountMinor!)).toBe(3870n);
  expect(after.transactions).toEqual(expect.arrayContaining(before.transactions));
  await wallet.getByRole('button', { name: 'הוספת כסף', exact: true }).click();
  await page.getByRole('button', { name: 'הכנסה חדשה במזומן', exact: true }).click();
  editor = page.getByRole('dialog', { name: 'הכנסה חדשה', exact: true });
  await expect(editor.getByRole('combobox', { name: 'חשבון / אמצעי תשלום', exact: true })).toHaveValue(`account:${cash.id}`);
  await editor.getByLabel('סכום בשקלים', { exact: true }).fill('50');
  await editor.getByRole('button', { name: 'הכנסה אחרת', exact: true }).click();
  await editor.getByRole('button', { name: 'שמירת הכנסה', exact: true }).click(); await expect(editor).toBeHidden();
  expect(accountBalance(cash.id, await snapshot(page)).amountMinor).toBe('10130');
  await page.reload(); await expect(page.getByRole('navigation')).toBeVisible();
  expect((await snapshot(page)).accounts.filter(account => account.kind === 'cash')).toHaveLength(1);
});
