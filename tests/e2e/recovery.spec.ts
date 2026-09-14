import { expect, test } from '@playwright/test';

const fixture = 'http://127.0.0.1:54321';
const email = 'owner@lova.test';
const originalPassword = 'local-only-passphrase';
const changedPassword = 'recovery-fixture-only-passphrase';

test('recovery request, callback, password update and new-password login work together', async ({ page, request, baseURL }) => {
  // Only disposable fixture credentials are used. Never run this against hosted Auth.
  expect(await (await request.get(`${fixture}/health`)).json()).toMatchObject({ testOnly: true });
  await request.post(`${fixture}/__test/reset`, { headers: { 'x-lova-test-key': 'local-fixture-only' }, data: {} });
  const tokenResponse = await request.post(`${fixture}/auth/v1/token?grant_type=password`, { data: { email, password: originalPassword } });
  expect(tokenResponse.ok()).toBeTruthy();
  const session = await tokenResponse.json();
  let recoveryRequested = false;
  await page.route(`${fixture}/auth/v1/recover?*`, async route => {
    const incoming = route.request();
    expect(new URL(incoming.url()).searchParams.get('redirect_to')).toBe(new URL(baseURL!).origin);
    expect(incoming.postDataJSON()).toMatchObject({ email });
    recoveryRequested = true;
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  try {
    await page.goto('/');
    await page.getByLabel('דוא״ל', { exact: true }).fill(email);
    await page.getByRole('button', { name: 'שכחתי סיסמה', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('קישור לעדכון הסיסמה');
    expect(recoveryRequested).toBeTruthy();
    await page.unroute(`${fixture}/auth/v1/recover?*`);
    await page.route(`${fixture}/auth/v1/recover?*`, route => route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ msg: 'email rate limit exceeded' }) }));
    await page.getByRole('button', { name: 'שכחתי סיסמה', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('הבקשה הזו לא שלחה מייל חדש');
    await expect(page.getByRole('status')).toHaveCount(0);

    // Emulate Supabase's verified-email redirect with a locally signed test session.
    const fragment = new URLSearchParams({ access_token: session.access_token, refresh_token: session.refresh_token, token_type: 'bearer', expires_in: String(session.expires_in), type: 'recovery' });
    await page.goto('about:blank');
    await page.goto(`/#${fragment}`);
    await expect(page.getByRole('heading', { name: 'סיסמה חדשה', exact: true })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'ניווט ראשי' })).toHaveCount(0);
    await page.getByLabel('סיסמה חדשה', { exact: true }).fill(changedPassword);
    await page.getByRole('button', { name: 'עדכון הסיסמה', exact: true }).click();
    await expect(page.getByRole('navigation', { name: 'ניווט ראשי' })).toBeVisible();
    expect(new URL(page.url()).hash).not.toContain('access_token');

    await page.getByRole('button', { name: 'סקירת הנתונים שלי', exact: true }).click();
    await page.getByRole('button', { name: 'יציאה מהחשבון', exact: true }).click();
    await page.getByRole('button', { name: 'יציאה ומחיקת טיוטות מקומיות', exact: true }).click();
    await page.getByLabel('דוא״ל', { exact: true }).fill(email);
    await page.getByLabel('סיסמה', { exact: true }).fill(changedPassword);
    await page.getByRole('button', { name: 'כניסה לחשבון', exact: true }).click();
    await expect(page.getByRole('navigation', { name: 'ניווט ראשי' })).toBeVisible();
  } finally {
    const restored = await request.put(`${fixture}/auth/v1/user`, { headers: { Authorization: `Bearer ${session.access_token}` }, data: { password: originalPassword } });
    expect(restored.ok()).toBeTruthy();
  }
});
