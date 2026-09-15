import { expect, test } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
let server:Server, base:string, version=1;
test.beforeAll(async()=>{
  server=createServer(async(req,res)=>{
    const path=new URL(req.url!,'http://localhost').pathname;
    if(path==='/audit-api'){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({amountMinor:'1290'}));return;}
    try{
      const file=resolve('dist','.'+(path==='/'?'/index.html':path));
      if(!file.startsWith(resolve('dist')+'/'))throw new Error('Invalid path');
      const mime:Record<string,string>={'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png','.woff2':'font/woff2','.webmanifest':'application/manifest+json'};
      res.writeHead(200,{'Content-Type':mime[extname(file)]??'application/octet-stream','Cache-Control':'no-store'});
      const body=await readFile(file);res.end(path==='/sw.js'?Buffer.concat([body,Buffer.from(`\n// audit version ${version}\n`)]):body);
    }catch{res.writeHead(404);res.end();}
  });
  await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
  const address=server.address();if(!address||typeof address==='string')throw new Error('No port');base=`http://127.0.0.1:${address.port}`;
});
test.afterAll(async()=>{await new Promise<void>((done,reject)=>server.close(error=>error?reject(error):done()));});
test('production worker installs before login, caches only static assets and updates with consent',async({page,context})=>{
  // No request may reach a real backend, even though this is the production build.
  await context.route('https://*.supabase.co/**',route=>route.abort());
  await page.goto(base);
  await expect(page.getByRole('button',{name:'כניסה לחשבון',exact:true})).toBeVisible();
  await page.evaluate(async()=>{await navigator.serviceWorker.ready;});
  await page.reload();
  await expect.poll(()=>page.evaluate(()=>Boolean(navigator.serviceWorker.controller))).toBe(true);
  await page.evaluate(async()=>{
    await fetch('/audit-api'); await fetch('/audit-api',{method:'POST',body:'{}'});
  });
  const urls=await page.evaluate(async()=>{const keys=await caches.keys();return(await Promise.all(keys.map(async key=>(await(await caches.open(key)).keys()).map(r=>r.url)))).flat();});
  expect(urls.length).toBeGreaterThan(0);expect(urls.some(url=>/audit-api|supabase|auth\/v1|rest\/v1/.test(url))).toBe(false);
  version++;
  await page.evaluate(async()=>{const registration=await navigator.serviceWorker.ready;await registration.update();});
  const update=page.getByRole('button',{name:'רענון והתקנת העדכון',exact:true});
  await expect(update).toBeVisible();
  await expect.poll(()=>page.evaluate(async()=>Boolean((await navigator.serviceWorker.ready).waiting))).toBe(true);
  // A waiting worker must not interrupt an actual unfinished form.
  await page.getByLabel('סיסמה', { exact: true }).fill('unsent-local-form');
  await expect(update).toBeHidden();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  expect(await page.evaluate(async()=>Boolean((await navigator.serviceWorker.ready).waiting))).toBe(true);
  await expect(page.getByLabel('סיסמה', { exact: true })).toHaveValue('unsent-local-form');
  await page.getByLabel('סיסמה', { exact: true }).fill('');
  await expect(update).toBeVisible();
  await update.click();
  await expect(update).toBeHidden();
  await expect.poll(()=>page.evaluate(async()=>Boolean((await navigator.serviceWorker.ready).waiting))).toBe(false);
  await context.setOffline(true);await page.reload();
  await expect(page.getByRole('button',{name:'כניסה לחשבון',exact:true})).toBeVisible();
  expect(await page.evaluate(async()=>{try{await fetch('/audit-api');return false;}catch{return true;}})).toBe(true);
  await expect(page.getByRole('navigation')).toHaveCount(0);
});

test('waiting update preserves a dirty entity form and its discard confirmation', async ({ page, context }) => {
  const { createDatabase, asUser, dataset, OWNER_ID } = await import('../database/harness');
  const db = await createDatabase();
  try {
    await asUser(db);
    const snapshot = await dataset(db);
    const user = { id: OWNER_ID, aud: 'authenticated', role: 'authenticated', email: 'owner@lova.test', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
    const expires = Math.floor(Date.now() / 1000) + 3600;
    const token = `${Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: OWNER_ID, exp: expires })).toString('base64url')}.local-fixture-only`;
    // Fulfill every backend request locally. No real Auth or financial data is read.
    await context.route('https://*.supabase.co/**', async route => {
      const path = new URL(route.request().url()).pathname;
      const body = path === '/auth/v1/token' ? { access_token: token, refresh_token: 'local-fixture-only', token_type: 'bearer', expires_in: 3600, expires_at: expires, user }
        : path === '/auth/v1/user' ? user : path === '/rest/v1/rpc/get_dataset' ? snapshot : null;
      if (body === null) { await route.abort(); return; }
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    });
    await page.goto(base);
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.reload();
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
    await page.getByLabel('דוא״ל', { exact: true }).fill('owner@lova.test');
    await page.getByLabel('סיסמה', { exact: true }).fill('local-only-passphrase');
    await page.getByRole('button', { name: 'כניסה לחשבון', exact: true }).click();
    await page.getByRole('navigation').getByRole('button', { name: 'התחייבויות', exact: true }).click();
    await page.getByRole('tab', { name: 'קבועים', exact: true }).click();
    await page.getByRole('button', { name: 'התחייבות', exact: true }).click();
    await page.getByLabel('שם', { exact: true }).fill('טיוטה בזמן עדכון');
    version++;
    await page.evaluate(async () => { await (await navigator.serviceWorker.ready).update(); });
    const waiting = () => page.evaluate(async () => Boolean((await navigator.serviceWorker.ready).waiting));
    await expect.poll(waiting).toBe(true);
    const update = page.getByRole('button', { name: 'רענון והתקנת העדכון', exact: true });
    await expect(update).toBeHidden();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'המשך עריכה', exact: true })).toBeVisible();
    await expect(update).toBeHidden();
    expect(await waiting()).toBe(true);
    await page.getByRole('button', { name: 'המשך עריכה', exact: true }).click();
    await expect(page.getByLabel('שם', { exact: true })).toHaveValue('טיוטה בזמן עדכון');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'יציאה ללא שמירה', exact: true }).click();
    await expect(update).toBeVisible();
    await update.click();
    await expect.poll(waiting).toBe(false);
  } finally { await db.close(); }
});
