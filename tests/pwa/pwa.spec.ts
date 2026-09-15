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
