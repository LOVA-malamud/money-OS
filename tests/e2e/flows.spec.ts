import { readFile } from 'node:fs/promises';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import type { Backup, Dataset } from '../../src/domain/types';

const fixture = 'http://127.0.0.1:54321';
const accessTokens = new WeakMap<Page, string>();
const bankId = '20000000-0000-4000-8000-000000000001';
const loanId = '20000000-0000-4000-8000-000000000004';

async function reset(request: APIRequestContext, seed = true) {
  const health = await request.get(`${fixture}/health`);
  expect(await health.json()).toMatchObject({ testOnly: true });
  const response = await request.post(`${fixture}/__test/reset`, { headers: { 'x-lova-test-key': 'local-fixture-only' }, data: { seed } });
  expect(response.ok()).toBeTruthy();
}
async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('דוא״ל', { exact: true }).fill('owner@lova.test');
  await page.getByLabel('סיסמה', { exact: true }).fill('local-only-passphrase');
  const response = page.waitForResponse(value => value.url().includes('/auth/v1/token') && value.status() === 200);
  await page.getByRole('button', { name: 'כניסה לחשבון', exact: true }).click();
  accessTokens.set(page, (await (await response).json()).access_token);
  await expect(page.getByRole('navigation', { name: 'ניווט ראשי' })).toBeVisible();
}
async function snapshot(page: Page): Promise<Dataset> {
  const response = await page.request.post(`${fixture}/rest/v1/rpc/get_dataset`, { headers: { Authorization: `Bearer ${accessTokens.get(page)}` }, data: {} });
  expect(response.ok()).toBeTruthy();
  return response.json();
}
async function nav(page: Page, name: string) {
  await page.getByRole('navigation', { name: 'ניווט ראשי' }).getByRole('button', { name, exact: true }).click();
}
async function openExpense(page: Page, amount = '68') {
  await page.getByRole('button', { name: 'הוספת הוצאה', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'הוצאה חדשה', exact: true });
  await expect(dialog.getByLabel('סכום בשקלים', { exact: true })).toBeFocused();
  await dialog.getByLabel('סכום בשקלים', { exact: true }).fill(amount);
  await dialog.getByRole('button', { name: 'אוכל', exact: true }).click();
  return dialog;
}
async function saveExpense(page: Page, amount = '68') {
  const dialog = await openExpense(page, amount);
  await dialog.getByRole('button', { name: 'שמירת הוצאה', exact: true }).click();
  await expect(dialog).toBeHidden();
}
async function settings(page: Page) {
  await nav(page, 'הכסף שלי');
  await page.getByRole('button', { name: 'הגדרות וגיבוי', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'הגדרות וגיבוי', exact: true })).toBeVisible();
}
async function expectNoOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy();
  for (const dialog of await page.getByRole('dialog').all()) {
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBeTruthy();
  }
}

test.beforeEach(async ({ request }) => { await reset(request); });

test('private login rejects a bad password, then loads the owner workspace', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('סיסמה', { exact: true }).fill('incorrect-password');
  await page.getByRole('button', { name: 'כניסה לחשבון', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('אינן נכונות');
  await expect(page.getByRole('navigation', { name: 'ניווט ראשי' })).toHaveCount(0);
  await login(page);
  await expect(page.getByRole('heading', { name: 'זמין עכשיו', exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expectNoOverflow(page);
});

test('login network failure remains an error rather than a zero-data dashboard', async ({ page }) => {
  await page.route('**/auth/v1/token?*', route => route.abort('failed'));
  await page.goto('/');
  await page.getByLabel('סיסמה', { exact: true }).fill('local-only-passphrase');
  await page.getByRole('button', { name: 'כניסה לחשבון', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'ניווט ראשי' })).toHaveCount(0);
});

test('Quiet Balance and Quick Add fit the viewport; draft, double tap and undo preserve one write', async ({ page }, testInfo) => {
  await login(page);
  await page.screenshot({ path: testInfo.outputPath('overview.png'), fullPage: true });
  const before = await snapshot(page);
  let dialog = await openExpense(page);
  await expectNoOverflow(page);
  const saveBox = await dialog.getByRole('button', { name: 'שמירת הוצאה', exact: true }).boundingBox();
  expect(saveBox).toBeTruthy();
  expect(saveBox!.y + saveBox!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  const keypadBottom = await dialog.getByRole('button', { name: 'נקודה עשרונית', exact: true }).boundingBox();
  expect(keypadBottom!.y + keypadBottom!.height).toBeLessThanOrEqual(saveBox!.y - 8);
  await page.screenshot({ path: testInfo.outputPath('quick-add.png') });
  await page.keyboard.press('Tab');
  expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBeTruthy();
  await dialog.getByRole('button', { name: 'סגירה', exact: true }).click();
  await page.getByRole('button', { name: 'הוספת הוצאה', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'הוצאה חדשה', exact: true });
  await expect(dialog.getByLabel('סכום בשקלים', { exact: true })).toHaveValue('68');
  await expect(dialog.getByRole('button', { name: 'אוכל', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog.getByText('הטיוטה האחרונה מחכה לך כאן.')).toBeVisible();
  await dialog.getByRole('button', { name: 'שמירת הוצאה', exact: true }).click({ clickCount: 2 });
  await expect(dialog).toBeHidden();
  const after = await snapshot(page);
  const added = after.transactions.filter(transaction => !before.transactions.some(previous => previous.id === transaction.id));
  expect(added).toHaveLength(1);
  expect(added[0].input).toMatchObject({ kind: 'expense', amountMinor: '6800', accountId: bankId });
  await page.locator('.toast').getByRole('button', { name: 'ביטול', exact: true }).click();
  await expect(page.locator('.toast')).toContainText('הפעולה בוטלה');
  expect((await snapshot(page)).transactions.find(transaction => transaction.id === added[0].id)?.voided).toBe(true);
});

test('the touch keypad enters a decimal expense without a Next step', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: 'הוספת הוצאה', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'הוצאה חדשה', exact: true });
  for (const name of ['6', '8', 'נקודה עשרונית', '5', '0']) await dialog.getByRole('button', { name, exact: true }).click();
  await expect(dialog.getByLabel('סכום בשקלים', { exact: true })).toHaveValue('68.50');
  await dialog.getByRole('button', { name: 'אוכל', exact: true }).click();
  await dialog.getByRole('button', { name: 'שמירת הוצאה', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect((await snapshot(page)).transactions.some(transaction => transaction.input.amountMinor === '6850')).toBeTruthy();
});

test('a committed expense with a lost response retries the same operation exactly once', async ({ page }) => {
  await login(page);
  const before = await snapshot(page);
  let interrupted = false;
  await page.route('**/rest/v1/rpc/execute_command', async route => {
    if (interrupted) { await route.continue(); return; }
    interrupted = true;
    const response = await route.fetch();
    expect(response.ok()).toBeTruthy();
    await route.abort('failed');
  });
  const editor = await openExpense(page, '72.50');
  await editor.getByRole('button', { name: 'שמירת הוצאה', exact: true }).click();
  await expect(editor.getByRole('alert')).toBeVisible();
  await editor.getByRole('button', { name: 'סגירה', exact: true }).click();
  await page.getByRole('button', { name: 'בדיקת השמירה וניסיון חוזר', exact: true }).click();
  await expect(page.locator('.toast')).toContainText('השמירה נבדקה');
  const after = await snapshot(page);
  const added = after.transactions.filter(transaction => !before.transactions.some(previous => previous.id === transaction.id));
  expect(added).toHaveLength(1);
  expect(added[0].input.amountMinor).toBe('7250');
  await page.getByRole('button', { name: 'הוספת הוצאה', exact: true }).click();
  await expect(page.getByRole('dialog').getByLabel('סכום בשקלים', { exact: true })).toHaveValue('');
});

test('an older delayed refresh cannot replace the acknowledged post-save balance', async ({ page }) => {
  await login(page);
  let release!: () => void;
  let captured!: () => void;
  const ready = new Promise<void>(resolve => { captured = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  let first = true;
  await page.route('**/rest/v1/rpc/get_dataset', async route => {
    if (!first) { await route.continue(); return; }
    first = false;
    const response = await route.fetch();
    captured(); await gate;
    await route.fulfill({ response });
  });
  await page.getByRole('button', { name: 'רענון נתונים', exact: true }).click();
  await ready;
  await saveExpense(page, '68');
  const available = page.locator('.hero-number');
  const newBalance = await available.innerText();
  const oldResponse = page.waitForResponse('**/rest/v1/rpc/get_dataset');
  release(); await oldResponse;
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(available).toHaveText(newBalance);
});

test('history searches and filters real transactions, then edits, voids and undoes', async ({ page }) => {
  await login(page); await nav(page, 'תנועות');
  await page.getByRole('searchbox').fill('קפה בשכונה');
  await expect(page.locator('.transaction-row')).toHaveCount(1);
  await page.getByRole('button', { name: 'סינון', exact: true }).click();
  await page.getByLabel('מסכום בשקלים', { exact: true }).fill('100');
  await expect(page.locator('.transaction-row')).toHaveCount(0);
  await page.getByLabel('מסכום בשקלים', { exact: true }).fill('40');
  await page.getByLabel('עד סכום בשקלים', { exact: true }).fill('50');
  await page.getByRole('combobox', { name: 'סוג תנועה', exact: true }).selectOption('expense');
  await expect(page.locator('.transaction-row')).toHaveCount(1);
  await page.locator('.transaction-row').click();
  await page.getByRole('dialog').getByRole('button', { name: 'עריכת התנועה', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'עריכת הוצאה', exact: true });
  await editor.getByLabel('סכום בשקלים', { exact: true }).fill('48');
  await editor.getByLabel('בית עסק', { exact: true }).fill('קפה בשכונה נערך');
  await editor.getByRole('button', { name: 'שמירת השינויים', exact: true }).click();
  await expect(editor).toBeHidden();
  await expect(page.locator('.transaction-row')).toContainText('₪48.00');
  const updated = (await snapshot(page)).transactions.find(transaction => transaction.input.merchant === 'קפה בשכונה נערך')!;
  expect(updated.input.amountMinor).toBe('4800');
  await page.locator('.transaction-row').click();
  await page.getByRole('dialog').getByRole('button', { name: 'ביטול התנועה', exact: true }).click();
  await page.getByRole('dialog', { name: 'ביטול תנועה', exact: true }).getByRole('button', { name: 'ביטול התנועה', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await snapshot(page)).transactions.find(transaction => transaction.id === updated.id)?.voided).toBe(true);
  await page.locator('.toast').getByRole('button', { name: 'ביטול', exact: true }).click();
  await expect(page.locator('.toast')).toContainText('הפעולה בוטלה');
  expect((await snapshot(page)).transactions.find(transaction => transaction.id === updated.id)?.voided).toBe(false);
  await expectNoOverflow(page);
});

test('refund keeps its original account/category and rejects an excessive second refund', async ({ page }) => {
  await login(page); await nav(page, 'תנועות');
  const original = (await snapshot(page)).transactions.find(transaction => transaction.input.merchant === 'קפה בשכונה')!;
  await page.getByRole('searchbox').fill('קפה בשכונה');
  await page.locator('.transaction-row').click();
  await page.getByRole('button', { name: 'רישום החזר כספי', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'החזר כספי', exact: true });
  await dialog.getByLabel('סכום בשקלים', { exact: true }).fill('12');
  await dialog.getByRole('button', { name: 'שמירה', exact: true }).click();
  await expect(dialog).toBeHidden();
  const refund = (await snapshot(page)).transactions.find(transaction => transaction.input.kind === 'refund')!;
  expect(refund.input).toMatchObject({ amountMinor: '1200', originalTransactionId: original.id, accountId: original.input.accountId, categoryId: original.input.categoryId });
  await page.locator('.transaction-row').click();
  await page.getByRole('button', { name: 'רישום החזר כספי', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'החזר כספי', exact: true });
  await dialog.getByLabel('סכום בשקלים', { exact: true }).fill('31');
  await dialog.getByRole('button', { name: 'שמירה', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('גבוה');
  expect((await snapshot(page)).transactions.filter(transaction => transaction.input.kind === 'refund')).toHaveLength(1);
});

test('empty setup distinguishes unknown balances, then records openings, income and a transfer', async ({ page, request }) => {
  await reset(request, false); await login(page);
  await expect(page.getByText('נשלים את התמונה כדי להציג יתרות שאפשר להבין.')).toBeVisible();
  await nav(page, 'הכסף שלי');
  async function addAccount(name: string, accountKind: string, opening: string) {
    await page.getByRole('button', { name: 'חשבון', exact: true }).click();
    const editor = page.getByRole('dialog', { name: 'הוספת חשבון', exact: true });
    await editor.getByLabel('שם', { exact: true }).fill(name);
    await editor.getByRole('combobox', { name: 'סוג החשבון', exact: true }).selectOption(accountKind);
    await editor.getByRole('button', { name: 'הוספה', exact: true }).click();
    const balance = page.getByRole('dialog', { name: 'יתרה התחלתית', exact: true });
    await expect(balance).toBeVisible();
    expect((await snapshot(page)).accounts.find(account => account.name === name)?.openingKnown).toBe(false);
    await balance.getByLabel('יתרה מעודכנת בשקלים', { exact: true }).fill(opening);
    await balance.getByRole('button', { name: 'שמירה', exact: true }).click();
    await expect(balance).toBeHidden();
  }
  await addAccount('חשבון בדיקה', 'bank', '1000');
  const wallet = page.locator('.list-row').filter({ has: page.getByRole('heading', { name: 'מזומן', exact: true }) });
  await wallet.getByRole('button', { name: 'יתרת פתיחה', exact: true }).click();
  const walletOpening = page.getByRole('dialog', { name: 'יתרה התחלתית', exact: true });
  await walletOpening.getByLabel('יתרה מעודכנת בשקלים', { exact: true }).fill('0');
  await walletOpening.getByRole('button', { name: 'שמירה', exact: true }).click();
  await expect(walletOpening).toBeHidden();
  await nav(page, 'תנועות');
  await page.getByRole('button', { name: 'הכנסה', exact: true }).click();
  let editor = page.getByRole('dialog', { name: 'הכנסה חדשה', exact: true });
  await editor.getByRole('combobox', { name: 'חשבון / אמצעי תשלום', exact: true }).selectOption({ label: 'חשבון בדיקה' });
  await editor.getByLabel('סכום בשקלים', { exact: true }).fill('500');
  await editor.getByRole('button', { name: 'משכורת', exact: true }).click();
  await editor.getByRole('button', { name: 'שמירת הכנסה', exact: true }).click();
  await expect(editor).toBeHidden();
  await page.getByRole('button', { name: 'העברה', exact: true }).click();
  editor = page.getByRole('dialog', { name: 'העברה בין חשבונות', exact: true });
  await editor.getByRole('combobox', { name: 'חשבון / אמצעי תשלום', exact: true }).selectOption({ label: 'חשבון בדיקה' });
  await editor.getByLabel('סכום בשקלים', { exact: true }).fill('125');
  await editor.getByRole('combobox', { name: 'אל חשבון', exact: true }).selectOption({ label: 'מזומן' });
  await editor.getByRole('button', { name: 'שמירה', exact: true }).click();
  await expect(editor).toBeHidden();
  const result = await snapshot(page);
  expect(result.transactions.filter(transaction => transaction.input.kind === 'income').map(transaction => transaction.input.amountMinor)).toEqual(['50000']);
  expect(result.transactions.filter(transaction => transaction.input.kind === 'expense')).toHaveLength(0);
  expect(result.transactions.find(transaction => transaction.input.kind === 'transfer')?.input.amountMinor).toBe('12500');
  expect(result.accounts.every(account => account.openingKnown)).toBe(true);
  await nav(page, 'הכסף שלי');
  await expect(page.getByText('₪1,375', { exact: true })).toBeVisible();
  await expect(page.getByText('₪125', { exact: true })).toBeVisible();
});

test('debt repayment requires an explicit split and records only interest/fees as spending', async ({ page }) => {
  await login(page); await nav(page, 'תנועות');
  await page.getByRole('button', { name: 'החזר חוב', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'תשלום חוב', exact: true });
  await editor.getByLabel('סכום בשקלים', { exact: true }).fill('110');
  await editor.getByRole('combobox', { name: 'החוב', exact: true }).selectOption(loanId);
  await editor.getByRole('button', { name: 'שמירה', exact: true }).click();
  await expect(editor.getByRole('alert')).toContainText('יש לציין ריבית ועמלות');
  await editor.getByLabel('ריבית · יש לציין גם אפס', { exact: true }).fill('10');
  await editor.getByLabel('עמלות · יש לציין גם אפס', { exact: true }).fill('0');
  await editor.getByRole('button', { name: 'כל הקטגוריות', exact: true }).click();
  await editor.getByRole('button', { name: 'ריבית ועמלות', exact: true }).click();
  await editor.getByRole('button', { name: 'שמירה', exact: true }).click();
  await expect(editor).toBeHidden();
  const repayment = (await snapshot(page)).transactions.find(transaction => transaction.input.kind === 'repayment')!;
  expect(repayment.input).toMatchObject({ amountMinor: '11000', principalMinor: '10000', interestMinor: '1000', feeMinor: '0', accountId: bankId, toAccountId: loanId });
  expect(repayment.postings.find(posting => posting.accountId === '@expense')?.amountMinor).toBe('1000');
  expect(repayment.postings.find(posting => posting.accountId === loanId)?.amountMinor).toBe('10000');
});

test('a monthly obligation becomes partially paid and then paid through linked transactions', async ({ page }) => {
  await login(page); await nav(page, 'התחייבויות');
  await page.getByRole('tab', { name: 'קבועים', exact: true }).click();
  await page.getByRole('button', { name: 'התחייבות', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'הוספת תשלום קבוע', exact: true });
  await editor.getByLabel('שם', { exact: true }).fill('מנוי בדיקה');
  await editor.getByLabel('סכום צפוי בשקלים', { exact: true }).fill('100');
  await editor.getByRole('combobox', { name: 'חשבון לתשלום · אם ידוע', exact: true }).selectOption(bankId);
  await editor.getByRole('combobox', { name: 'קטגוריה', exact: true }).selectOption({ label: 'בית וחשבונות' });
  await editor.getByRole('button', { name: 'הוספה', exact: true }).click();
  await expect(editor).toBeHidden();
  await page.getByRole('tab', { name: 'תשלומים', exact: true }).click();
  const row = page.getByRole('button', { name: 'פרטי תשלום: מנוי בדיקה', exact: true });
  await expect(row).toBeVisible();
  await row.click();
  await page.getByRole('dialog').getByRole('button', { name: 'רישום תשלום', exact: true }).click();
  let payment = page.getByRole('dialog', { name: 'הוצאה חדשה', exact: true });
  await payment.getByLabel('סכום בשקלים', { exact: true }).fill('40');
  await payment.getByRole('button', { name: 'שמירת הוצאה', exact: true }).click();
  await expect(payment).toBeHidden();
  await expect(row).toContainText('שולם חלקית');
  await expect(row).toContainText('₪60');
  await row.click();
  await page.getByRole('dialog').getByRole('button', { name: 'רישום תשלום', exact: true }).click();
  payment = page.getByRole('dialog', { name: 'הוצאה חדשה', exact: true });
  await expect(payment.getByLabel('סכום בשקלים', { exact: true })).toHaveValue('60.00');
  await payment.getByRole('button', { name: 'שמירת הוצאה', exact: true }).click();
  await expect(payment).toBeHidden();
  await expect(row).toContainText('שולם');
  const result = await snapshot(page);
  const obligation = result.obligations.find(item => item.title === 'מנוי בדיקה')!;
  expect(result.allocations.filter(item => item.obligationId === obligation.id).map(item => item.amountMinor).sort()).toEqual(['4000', '6000']);
});

test('offline expense remains a draft until a confirmed save after reconnecting', async ({ page, context }) => {
  await login(page);
  const before = await snapshot(page);
  let editor = await openExpense(page, '68');
  await context.setOffline(true);
  await editor.getByRole('button', { name: 'שמירת הוצאה', exact: true }).click();
  await expect(editor.getByRole('alert')).toContainText('אין חיבור');
  await editor.getByRole('button', { name: 'סגירה', exact: true }).click();
  await page.getByRole('button', { name: 'הוספת הוצאה', exact: true }).click();
  editor = page.getByRole('dialog', { name: 'הוצאה חדשה', exact: true });
  await expect(editor.getByLabel('סכום בשקלים', { exact: true })).toHaveValue('68');
  await context.setOffline(false);
  await editor.getByRole('button', { name: 'שמירת הוצאה', exact: true }).click();
  await expect(editor).toBeHidden();
  expect((await snapshot(page)).transactions).toHaveLength(before.transactions.length + 1);
});

test('JSON backup download, invalid-file rejection and guarded restore preserve exact records', async ({ page }) => {
  await login(page); await settings(page);
  const original = await snapshot(page);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'יצירת גיבוי JSON', exact: true }).click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).toBeTruthy();
  const content = await readFile(path!, 'utf8');
  const backup = JSON.parse(content) as Backup;
  expect(backup.format).toBe('lova-money-os');
  expect(backup.data.transactions).toHaveLength(original.transactions.length);
  expect(content).not.toContain('local-only-passphrase');
  await page.getByLabel('בחירת קובץ גיבוי', { exact: true }).setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{"format":"not-a-backup"}') });
  await expect(page.getByRole('alert')).toBeVisible();
  expect((await snapshot(page)).transactions).toHaveLength(original.transactions.length);
  await saveExpense(page, '68');
  expect((await snapshot(page)).transactions).toHaveLength(original.transactions.length + 1);
  await page.getByLabel('בחירת קובץ גיבוי', { exact: true }).setInputFiles({ name: 'valid-backup.json', mimeType: 'application/json', buffer: Buffer.from(content) });
  const dialog = page.getByRole('dialog', { name: 'בדיקת הגיבוי לפני שחזור', exact: true });
  await expect(dialog).toBeVisible();
  const restore = dialog.getByRole('button', { name: 'שחזור הנתונים', exact: true });
  await expect(restore).toBeDisabled();
  const safetyDownload = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'הורדת עותק בטיחות', exact: true }).click();
  await safetyDownload;
  await expect(restore).toBeDisabled();
  await dialog.getByRole('checkbox', { name: 'שמרתי את עותק הבטיחות ואני רוצה להחליף את הנתונים.', exact: true }).check();
  await restore.click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('הגיבוי שוחזר. היתרות והדוחות חושבו מחדש.')).toBeVisible();
  const restored = await snapshot(page);
  expect(restored.generation).not.toBe(original.generation);
  expect(restored.transactions.map(transaction => transaction.id).sort()).toEqual(original.transactions.map(transaction => transaction.id).sort());
  await expectNoOverflow(page);
});
