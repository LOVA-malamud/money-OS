import { expect, test, type Locator, type Page } from '@playwright/test';
const fixture = 'http://127.0.0.1:54321';
async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('סיסמה', { exact: true }).fill('local-only-passphrase');
  await page.getByRole('button', { name: 'כניסה לחשבון', exact: true }).click();
  await expect(page.getByRole('navigation')).toBeVisible();
}
// These values model API transitions, not the native iOS keyboard/compositor.
async function geometry(page: Page, height: number, offsetTop: number) {
  await page.evaluate(({ height, offsetTop }) => {
    Object.defineProperty(window.visualViewport, 'height', { configurable: true, value: height });
    Object.defineProperty(window.visualViewport, 'offsetTop', { configurable: true, value: offsetTop });
    Object.defineProperty(window.visualViewport, 'pageTop', { configurable: true, get: () => window.scrollY + offsetTop });
    window.visualViewport!.dispatchEvent(new Event('resize'));
    window.visualViewport!.dispatchEvent(new Event('scroll'));
  }, { height, offsetTop });
}
async function probe(page: Page, control: Locator, touch: boolean) {
  await control.scrollIntoViewIfNeeded();
  await expect(control).toBeInViewport();
  const rect = (await control.boundingBox())!;
  const point = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  expect(await control.evaluate((element, point) => {
    const hit = document.elementFromPoint(point.x, point.y);
    return hit === element || element.contains(hit);
  }, point)).toBe(true);
  await control.evaluate(element => {
    delete (element as HTMLElement).dataset.pointerHit;
    const controller = new AbortController();
    (element as HTMLElement & { stopProbe: () => void }).stopProbe = () => controller.abort();
    document.addEventListener('pointerdown', event => {
      (element as HTMLElement).dataset.pointerHit = String(element === event.target || element.contains(event.target as Node));
      // Geometry probe only: don't submit, dismiss or open a native picker.
      event.preventDefault();
    }, { once: true, capture: true, signal: controller.signal });
    document.addEventListener('click', event => { event.preventDefault(); event.stopImmediatePropagation(); }, { once: true, capture: true, signal: controller.signal });
  });
  if (touch) await page.touchscreen.tap(point.x, point.y);
  else await page.mouse.click(point.x, point.y);
  await control.evaluate(element => (element as HTMLElement & { stopProbe: () => void }).stopProbe());
  await expect(control).toHaveAttribute('data-pointer-hit', 'true');
}
test.beforeEach(async ({ request }) => {
  expect(await (await request.get(`${fixture}/health`)).json()).toMatchObject({ testOnly: true });
  expect((await request.post(`${fixture}/__test/reset`, { headers: { 'x-lova-test-key': 'local-fixture-only' }, data: { seed: true } })).ok()).toBeTruthy();
});
test('sheet does not retain keyboard translation after the visual viewport returns to full height', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.getByRole('navigation').getByRole('button', { name: 'הכסף שלי', exact: true }).click();
  await page.getByRole('button', { name: 'עריכת רכב', exact: true }).scrollIntoViewIfNeeded();
  const scroll = await page.evaluate(() => window.scrollY);
  expect(scroll).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'הוספת הוצאה', exact: true }).click();
  await geometry(page, 380, 120);
  await expect.poll(async () => (await page.locator('.sheet-overlay').boundingBox())!.y).toBe(120);
  // iOS can deliver a restored height with an old keyboard-pan offset.
  await geometry(page, 844, 120);
  await expect.poll(async () => (await page.locator('.sheet-overlay').boundingBox())!.y).toBe(0);
  expect(await page.evaluate(() => getComputedStyle(document.body).position)).not.toBe('fixed');
  expect(await page.locator('.sheet-overlay').evaluate(e => getComputedStyle(e).position)).toBe('absolute');
  await page.getByRole('button', { name: 'סגירה', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(scroll);
});
test('coordinate taps target controls across Quick Add after focus and viewport transitions', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.getByRole('button', { name: 'הוספת הוצאה', exact: true }).click();
  const amount = page.getByLabel('סכום בשקלים', { exact: true });
  await amount.fill('12');
  await page.getByRole('button', { name: 'פרטים נוספים', exact: true }).click();
  const merchant = page.getByLabel('בית עסק', { exact: true });
  await merchant.fill('בדיקת מגע מקומית');
  for (const [height, top] of [[380, 120], [460, 60], [844, 120], [844, 0]]) {
    await merchant.focus();
    await geometry(page, height, top);
    await amount.scrollIntoViewIfNeeded();
    if (info.project.use.hasTouch) await amount.tap();
    else await amount.click();
    const controls = page.getByRole('dialog').locator('button,input,select,textarea').filter({ visible: true });
    for (const control of await controls.all()) await probe(page, control, Boolean(info.project.use.hasTouch));
  }
  await geometry(page, 844, 0);
  await page.getByRole('button', { name: 'פרטים נוספים', exact: true }).click();
  await amount.fill('');
  const nine = page.getByRole('button', { name: '9', exact: true });
  await nine.scrollIntoViewIfNeeded();
  const rect = (await nine.boundingBox())!;
  if (info.project.use.hasTouch) await page.touchscreen.tap(rect.x + rect.width / 2, rect.y + rect.height / 2);
  else await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await expect(amount).toHaveValue('9');
  await page.screenshot({ path: info.outputPath('quick-add-coordinate-tap.png') });
});
