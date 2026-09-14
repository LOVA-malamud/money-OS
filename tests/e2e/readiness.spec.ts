import { expect, test, type Page } from '@playwright/test';
const fixture='http://127.0.0.1:54321';
async function login(page:Page){
  await page.goto('/');
  await page.getByLabel('דוא״ל',{exact:true}).fill('owner@lova.test');
  await page.getByLabel('סיסמה',{exact:true}).fill('local-only-passphrase');
  await page.getByRole('button',{name:'כניסה לחשבון',exact:true}).click();
}
test.beforeEach(async({request})=>{
  expect(await (await request.get(`${fixture}/health`)).json()).toMatchObject({testOnly:true});
  expect((await request.post(`${fixture}/__test/reset`,{headers:{'x-lova-test-key':'local-fixture-only'},data:{seed:true}})).ok()).toBeTruthy();
});
test('unavailable, paused, throttled and unauthorized datasets never become a zero dashboard',async({page})=>{
  for(const failure of [{status:503,code:'SERVICE_UNAVAILABLE',message:'Project is paused'}, {status:429,code:'over_request_rate_limit',message:'Rate limit exceeded'}, {status:401,code:'PGRST301',message:'JWT expired'}, {status:403,code:'42501',message:'permission denied'}]){
    await page.route('**/rest/v1/rpc/get_dataset',route=>route.fulfill({status:failure.status,contentType:'application/json',body:JSON.stringify(failure)}));
    if(failure.status===503)await login(page);else await page.reload();
    await expect(page.getByRole('heading',{name:'הנתונים עדיין לא זמינים'})).toBeVisible();
    await expect(page.getByRole('navigation')).toHaveCount(0);
    await expect(page.locator('.hero-number')).toHaveCount(0);
    await expect(page.locator('main')).not.toContainText('₪0');
    await page.unroute('**/rest/v1/rpc/get_dataset');
  }
});
test('failed refresh marks the previous balance as stale and loading never invents zero',async({page})=>{
  let release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/rest/v1/rpc/get_dataset',async route=>{await gate;await route.continue();});
  await login(page);
  await expect(page.getByText('טוענים את הנתונים שלך…')).toBeVisible();
  await expect(page.locator('.hero-number')).toHaveCount(0);
  release(); await expect(page.getByRole('navigation')).toBeVisible();
  await page.unroute('**/rest/v1/rpc/get_dataset');
  const balance=await page.locator('.hero-number').innerText();
  await page.route('**/rest/v1/rpc/get_dataset',route=>route.abort('failed'));
  await page.getByRole('button',{name:'רענון נתונים',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('לא יתרה עדכנית מאומתת');
  await expect(page.locator('.hero-number')).toHaveText(balance);
});
test('large balances, enlarged text and a short viewport preserve usable RTL forms',async({page},info)=>{
  await login(page); await expect(page.getByRole('navigation')).toBeVisible();
  await page.getByRole('navigation').getByRole('button',{name:'תנועות',exact:true}).click();
  await page.getByRole('button',{name:'הכנסה',exact:true}).click();
  await page.getByLabel('סכום בשקלים',{exact:true}).fill('123456789.12');
  await page.getByRole('button',{name:'משכורת',exact:true}).click();
  await page.getByRole('button',{name:'שמירת הכנסה',exact:true}).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.getByRole('navigation').getByRole('button',{name:'סקירה',exact:true}).click();
  await page.setViewportSize({width:320,height:568});
  await page.screenshot({path:info.outputPath('large-balances.png'),fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBeTruthy();
  await page.addStyleTag({content:'html { font-size: 200% !important; }'});
  expect(await page.locator('.numeric > span').evaluateAll(elements=>elements.every(e=>{const r=e.getBoundingClientRect();return r.left>=-1&&r.right<=window.innerWidth+1;}))).toBeTruthy();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBeTruthy();
  await page.getByRole('button',{name:'הוספת הוצאה',exact:true}).click();
  const dialog=page.getByRole('dialog');
  await expect(page.getByLabel('סכום בשקלים',{exact:true})).toBeFocused();
  await page.setViewportSize({width:375,height:400});
  await page.getByLabel('סכום בשקלים',{exact:true}).fill('12.90');
  await page.getByRole('button',{name:'אוכל',exact:true}).click();
  await dialog.getByRole('button',{name:'פרטים נוספים',exact:true}).click();
  await dialog.getByLabel('בית עסק',{exact:true}).fill('בדיקת טופס');
  const save=dialog.getByRole('button',{name:'שמירת הוצאה',exact:true});
  await save.scrollIntoViewIfNeeded(); await expect(save).toBeInViewport();
  expect(await dialog.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBeTruthy();
  await dialog.getByRole('button',{name:'סגירה',exact:true}).click();
  await expect(page.getByRole('button',{name:'הוספת הוצאה',exact:true})).toBeFocused();
});
test('mobile controls have labels, reachable targets and trapped dialog focus',async({page},info)=>{
  await login(page);await expect(page.getByRole('navigation')).toBeVisible();
  for(const width of [320,375,390,430]){
    await page.setViewportSize({width,height:844});
    for(const button of await page.getByRole('navigation').getByRole('button').all()){
      const box=await button.boundingBox();expect(box).not.toBeNull();
      expect(box!.width).toBeGreaterThanOrEqual(44);expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.x).toBeGreaterThanOrEqual(-1);expect(box!.x+box!.width).toBeLessThanOrEqual(width+1);
    }
  }
  await page.getByRole('button',{name:'הוספת הוצאה',exact:true}).click();
  const dialog=page.getByRole('dialog');
  await expect(dialog).toHaveAttribute('aria-modal','true');
  const fields=await dialog.locator('input:not([type=hidden]),select,textarea').evaluateAll(elements=>elements.filter(element=>{
    const input=element as HTMLInputElement;
    return !input.labels?.length&&!input.getAttribute('aria-label')&&!input.getAttribute('aria-labelledby');
  }).length);
  expect(fields).toBe(0);
  const close=dialog.getByRole('button',{name:'סגירה',exact:true});await close.focus();await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button',{name:'שמירת הוצאה',exact:true})).toBeFocused();
  await page.keyboard.press('Tab');await expect(close).toBeFocused();
  await page.screenshot({path:info.outputPath('quick-add.png'),fullPage:true});
  await page.keyboard.press('Escape');await expect(dialog).toBeHidden();
  await expect(page.getByRole('button',{name:'הוספת הוצאה',exact:true})).toBeFocused();
});
