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
test('persistent top protection and measured navigation preserve safe areas on every screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.addStyleTag({ content: ':root { --safe-top: 59px; --safe-bottom: 34px; }' });
  for (const name of ['סקירה', 'תנועות', 'התחייבויות', 'הכסף שלי']) {
    await nav(page, name);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    const heading = await page.getByRole('heading', { level: 1 }).boundingBox();
    expect(heading!.y).toBeGreaterThanOrEqual(59);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const shield = await page.locator('.safe-area-shield').boundingBox();
    expect(shield).toMatchObject({ y: 0, height: 59, width: 390 });
    expect(await page.locator('.safe-area-shield').evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgb(17, 22, 21)');
    const navigation = page.getByRole('navigation');
    const box = await navigation.boundingBox();
    expect(box!.y + box!.height).toBe(844);
    for (const button of await navigation.getByRole('button').all()) {
      const bounds = await button.boundingBox();
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(844 - 34);
    }
    const main = await page.locator('.page').evaluate(element => ({ padding: parseFloat(getComputedStyle(element).paddingBottom), nav: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--nav-occupied')) }));
    expect(main.padding).toBeGreaterThan(main.nav);
  }
  await page.addStyleTag({ content: 'html {font-size:200%}' });
  await expect.poll(async () => {
    const box = await page.getByRole('navigation').boundingBox();
    return page.locator('.page').evaluate((element, height) => parseFloat(getComputedStyle(element).paddingBottom) > height, box!.height);
  }).toBe(true);
});
test('expense categories precede secondary controls; date is editable and draft survives a closed sheet', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: 'הוספת הוצאה', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(page.getByLabel('סכום בשקלים', { exact: true })).toBeFocused();
  await expect(dialog.locator('input[type=date]')).toHaveCount(0);
  expect(await dialog.evaluate(element => Boolean(element.querySelector('.category-picker')!.compareDocumentPosition(element.querySelector('.entry-context')!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
  await page.getByLabel('סכום בשקלים', { exact: true }).fill('12.90');
  await page.getByRole('button', { name: 'אוכל', exact: true }).click();
  await page.getByRole('button', { name: 'פרטים נוספים', exact: true }).click();
  await expect(dialog.locator('input[type=date]')).toBeVisible();
  await page.getByLabel('בית עסק', { exact: true }).fill('טיוטה מקומית בלבד');
  await page.getByRole('button', { name: 'סגירה', exact: true }).click();
  await page.getByRole('button', { name: 'הוספת הוצאה', exact: true }).click();
  await expect(page.getByLabel('סכום בשקלים', { exact: true })).toHaveValue('12.90');
  await expect(page.getByRole('button', { name: 'אוכל', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'שמירת הוצאה', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('status')).toContainText('נשמר בהצלחה');
});
test('sheets follow a keyboard viewport and isolate and restore background focus and scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await login(page); await nav(page, 'הכסף שלי');
  await page.addStyleTag({ content: ':root { --safe-top:59px; --safe-bottom:34px; }' });
  const trigger = page.getByRole('button', { name: 'עריכת מזומן', exact: true });
  await trigger.scrollIntoViewIfNeeded();
  const scroll = await page.evaluate(() => window.scrollY);
  await trigger.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await page.locator('#root').evaluate(element => element.inert)).toBe(true);
  // WebKit automation cannot summon the physical iOS keyboard. Exercise the
  // actual visualViewport resize listener with controlled keyboard geometry.
  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport, 'height', { configurable: true, value: 380 });
    Object.defineProperty(window.visualViewport, 'offsetTop', { configurable: true, value: 0 });
    window.visualViewport!.dispatchEvent(new Event('resize'));
  });
  await expect(page.locator('html')).toHaveAttribute('data-keyboard', 'true');
  const dialog = page.getByRole('dialog');
  const save = dialog.getByRole('button', { name: 'שמירת שינויים', exact: true });
  await save.scrollIntoViewIfNeeded();
  const box = await save.boundingBox();
  expect(box!.y).toBeGreaterThanOrEqual(59);
  expect(box!.y + box!.height).toBeLessThanOrEqual(380);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  expect(await page.locator('#root').evaluate(element => element.inert)).toBe(false);
  await expect(trigger).toBeFocused();
  expect(await page.evaluate(() => window.scrollY)).toBe(scroll);
});
test('empty commitments explain missing coverage and offer a next step, with RTL keyboard tabs', async ({ page, request }) => {
  await request.post(`${fixture}/__test/reset`, { headers: { 'x-lova-test-key': 'local-fixture-only' }, data: { seed: false } });
  await login(page);
  await expect(page.getByText('חסרה יתרת פתיחה', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'השלמת יתרות', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'הכסף שלי', exact: true })).toBeVisible();
  await nav(page, 'התחייבויות');
  await expect(page.getByRole('heading', { name: 'עדיין לא הוספת תשלומים', exact: true })).toBeVisible();
  await expect(page.getByRole('tabpanel')).not.toContainText('₪0');
  await page.getByRole('tab', { name: 'תשלומים', exact: true }).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('tab', { name: 'קבועים', exact: true })).toBeFocused();
  await expect(page.getByRole('tabpanel')).toContainText('עדיין לא הוספת תשלומים קבועים');
  await page.keyboard.press('End');
  await expect(page.getByRole('tabpanel')).toContainText('עדיין לא הוספת חובות');
  await page.getByRole('button', { name: 'סקירה ואישור הרשימה', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'הגדרות וגיבוי', exact: true })).toBeVisible();
});
test('backup stays reachable and dirty settings block updates without changing saved data', async ({ page }) => {
  await login(page); await nav(page, 'הכסף שלי');
  await page.getByRole('button', { name: 'הגדרות וגיבוי', exact: true }).click();
  const backup = page.getByRole('heading', { name: 'הגיבוי שלך, בשליטתך', exact: true });
  const categories = page.getByRole('heading', { name: 'קטגוריות', exact: true });
  expect((await backup.boundingBox())!.y).toBeLessThan((await categories.boundingBox())!.y);
  await page.getByText('עדכון תקופת המעקב', { exact: true }).click();
  await page.getByLabel('כל התנועות שלי הוזנו החל מתאריך', { exact: true }).fill('2026-01-01');
  await expect(page.locator('[data-update-blocked="true"]')).toHaveCount(1);
  await nav(page, 'סקירה');
  await expect(page.locator('[data-update-blocked="true"]')).toHaveCount(0);
});
test('all main screens retain their content at narrow widths and 200 percent text', async ({ page }) => {
  await login(page);
  await nav(page, 'הכסף שלי');
  await page.getByRole('button', {name:'עריכת החשבון שלי', exact:true}).click();
  await page.getByLabel('שם', {exact:true}).fill('חשבון הבנק לתשלומים ולהוצאות המשפחתיות עם שם ארוך במיוחד לצורך בדיקת קריאות ונגישות');
  await page.getByRole('button', {name:'שמירת שינויים', exact:true}).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.addStyleTag({ content: 'html { font-size:200% !important; }' });
  for (const width of [320,375,390,430]) {
    await page.setViewportSize({ width, height: 568 });
    for (const name of ['סקירה','תנועות','התחייבויות','הכסף שלי']) {
      await nav(page, name);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${name} at ${width}`).toBe(true);
    }
  }
});
test('a blocked device backup preference cannot turn a successful JSON download into a failure', async ({ page }) => {
  await page.addInitScript(() => {
    const get = Storage.prototype.getItem;
    const set = Storage.prototype.setItem;
    Storage.prototype.getItem = function(key) { if (key.endsWith(':last-export')) throw new DOMException('Unavailable','SecurityError'); return get.call(this,key); };
    Storage.prototype.setItem = function(key,value) { if (key.endsWith(':last-export')) throw new DOMException('Unavailable','QuotaExceededError'); return set.call(this,key,value); };
  });
  await login(page); await nav(page,'הכסף שלי');
  await page.getByRole('button',{name:'הגדרות וגיבוי',exact:true}).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button',{name:'יצירת גיבוי JSON',exact:true}).click();
  expect((await download).suggestedFilename()).toMatch(/^lova-money-.*\.json$/);
  await expect(page.getByRole('status')).toContainText('קובץ הגיבוי הוכן להורדה');
  await expect(page.getByRole('alert')).toHaveCount(0);
});
test('a failed remote sign-out reports its limit after local sign-out and clears local drafts', async ({ page }) => {
  await login(page);
  await page.getByRole('button',{name:'הוספת הוצאה',exact:true}).click();
  await page.getByLabel('סכום בשקלים',{exact:true}).fill('20');
  await page.getByRole('button',{name:'סגירה',exact:true}).click();
  expect(await page.evaluate(() => Object.keys(localStorage).some(key => key.includes(':entry:')))).toBe(true);
  await nav(page,'הכסף שלי');
  await page.getByRole('button',{name:'הגדרות וגיבוי',exact:true}).click();
  await page.getByRole('button',{name:'יציאה מהחשבון',exact:true}).click();
  await page.route('**/auth/v1/logout*',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'Service unavailable'})}));
  await page.getByRole('button',{name:'יציאה ומחיקת טיוטות מקומיות',exact:true}).click();
  await expect(page.getByRole('button',{name:'כניסה לחשבון',exact:true})).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('לא ניתן לאשר יציאה מכל המכשירים');
  await expect(page.getByRole('alert')).toContainText('הטיוטות המקומיות נמחקו');
  await expect(page.getByRole('navigation')).toHaveCount(0);
  expect(await page.evaluate(() => Object.keys(localStorage).some(key => key.includes(':entry:')))).toBe(false);
});

test('all keypad keys and Save fit iPhone safe areas even with a restored expense draft', async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  await login(page);
  await page.addStyleTag({content:':root {--safe-top:59px;--safe-bottom:34px}'});
  for (let attempt=0; attempt<2; attempt++) {
    await page.getByRole('button',{name:'הוספת הוצאה',exact:true}).click();
    await page.getByLabel('סכום בשקלים',{exact:true}).fill('68');
    await page.getByRole('button',{name:'אוכל',exact:true}).click();
    const save=await page.getByRole('button',{name:'שמירת הוצאה',exact:true}).boundingBox();
    expect(save!.y+save!.height).toBeLessThanOrEqual(844-34);
    for (const key of await page.locator('.entry-keypad button').all()) {
      const box=await key.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.y).toBeGreaterThanOrEqual(59);
      expect(box!.y+box!.height).toBeLessThanOrEqual(save!.y-8);
    }
    await page.getByRole('button',{name:'סגירה',exact:true}).click();
  }
});
