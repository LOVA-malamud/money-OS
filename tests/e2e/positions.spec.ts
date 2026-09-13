import { expect, test, type Page } from '@playwright/test';
import type { Dataset } from '../../src/domain/types';

const fixture = 'http://127.0.0.1:54321';
const bank = '20000000-0000-4000-8000-000000000001';
const asset = '20000000-0000-4000-8000-000000000005';
const loan = '20000000-0000-4000-8000-000000000004';
const tokens = new WeakMap<Page,string>();
async function data(page: Page): Promise<Dataset> {
  const response = await page.request.post(`${fixture}/rest/v1/rpc/get_dataset`, { headers: { Authorization: `Bearer ${tokens.get(page)}` }, data: {} });
  expect(response.ok()).toBeTruthy(); return response.json();
}
async function nav(page: Page, name: string) { await page.getByRole('navigation').getByRole('button', { name, exact:true }).click(); }
test.beforeEach(async ({page,request}) => {
  expect((await request.post(`${fixture}/__test/reset`, { headers:{'x-lova-test-key':'local-fixture-only'}, data:{seed:true} })).ok()).toBeTruthy();
  await page.goto('/');
  await page.getByLabel('דוא״ל',{exact:true}).fill('owner@lova.test');
  await page.getByLabel('סיסמה',{exact:true}).fill('local-only-passphrase');
  const session = page.waitForResponse(response=>response.url().includes('/auth/v1/token')&&response.status()===200);
  await page.getByRole('button',{name:'כניסה לחשבון',exact:true}).click();
  tokens.set(page,(await (await session).json()).access_token);
  await expect(page.getByRole('navigation')).toBeVisible();
});

test('borrowing, asset valuation and asset transfer preserve the distinct financial concepts',async({page},info)=>{
  const before=await data(page);
  await nav(page,'התחייבויות'); await page.getByRole('tab',{name:'חובות',exact:true}).click();
  const debt=page.locator('section').filter({has:page.getByRole('heading',{name:'הלוואה משפחתית',exact:true})});
  await debt.getByRole('button',{name:'קבלת הלוואה',exact:true}).click();
  let editor=page.getByRole('dialog',{name:'קבלת הלוואה',exact:true});
  await editor.getByLabel('סכום בשקלים',{exact:true}).fill('100');
  await editor.getByRole('button',{name:'שמירה',exact:true}).click(); await expect(editor).toBeHidden();
  const borrowing=(await data(page)).transactions.find(tx=>tx.input.kind==='borrowing')!;
  expect(borrowing.postings).toEqual(expect.arrayContaining([{accountId:bank,amountMinor:'10000'},{accountId:loan,amountMinor:'-10000'}]));
  await nav(page,'הכסף שלי'); await page.getByRole('button',{name:'עדכון שווי',exact:true}).click();
  editor=page.getByRole('dialog',{name:'עדכון שווי נכס',exact:true});
  await editor.getByLabel('יתרה מעודכנת בשקלים',{exact:true}).fill('30000');
  await editor.getByRole('button',{name:'שמירה',exact:true}).click(); await expect(editor).toBeHidden();
  await nav(page,'תנועות'); await page.getByRole('button',{name:'העברה',exact:true}).click();
  editor=page.getByRole('dialog',{name:'העברה בין חשבונות',exact:true});
  await editor.getByRole('combobox',{name:'חשבון / אמצעי תשלום',exact:true}).selectOption(`account:${bank}`);
  await editor.getByRole('combobox',{name:'אל חשבון',exact:true}).selectOption(asset);
  await editor.getByLabel('סכום בשקלים',{exact:true}).fill('100');
  await editor.getByRole('button',{name:'שמירה',exact:true}).click(); await expect(editor).toBeHidden();
  const after=await data(page);
  expect(after.transactions.filter(tx=>['income','expense'].includes(tx.input.kind))).toEqual(before.transactions.filter(tx=>['income','expense'].includes(tx.input.kind)));
  expect(after.transactions.find(tx=>tx.input.kind==='valuation')?.input.amountMinor).toBe('3000000');
  expect(after.transactions.find(tx=>tx.input.kind==='transfer')?.postings).toEqual(expect.arrayContaining([{accountId:bank,amountMinor:'-10000'},{accountId:asset,amountMinor:'10000'}]));
  await nav(page,'הכסף שלי'); await page.screenshot({path:info.outputPath('money.png'),fullPage:true});
});

test('a card credit stays a positive balance when its opening is edited',async({page})=>{
  await nav(page,'הכסף שלי'); await page.getByRole('button',{name:'כרטיס',exact:true}).click();
  let editor=page.getByRole('dialog',{name:'הוספת חשבון',exact:true});
  await editor.getByLabel('שם',{exact:true}).fill('כרטיס עם יתרת זכות');
  await editor.getByRole('button',{name:'הוספה',exact:true}).click();
  editor=page.getByRole('dialog',{name:'יתרה התחלתית',exact:true});
  await editor.getByRole('combobox',{name:'מצב היתרה בכרטיס',exact:true}).selectOption('credit');
  await editor.getByLabel('סכום יתרת הזכות בשקלים',{exact:true}).fill('100');
  await editor.getByRole('button',{name:'שמירה',exact:true}).click(); await expect(editor).toBeHidden();
  const card=(await data(page)).accounts.find(account=>account.name==='כרטיס עם יתרת זכות')!;
  await nav(page,'תנועות'); await page.getByRole('searchbox').fill(card.name); await page.locator('.transaction-row').click();
  await page.getByRole('button',{name:'עריכת התנועה',exact:true}).click();
  editor=page.getByRole('dialog',{name:'עריכת יתרה התחלתית',exact:true});
  await expect(editor.getByRole('combobox',{name:'מצב היתרה בכרטיס',exact:true})).toHaveValue('credit');
  await editor.getByLabel('סכום יתרת הזכות בשקלים',{exact:true}).fill('150');
  await editor.getByRole('button',{name:'שמירת השינויים',exact:true}).click(); await expect(editor).toBeHidden();
  expect((await data(page)).transactions.find(tx=>tx.input.accountId===card.id)?.input.amountMinor).toBe('15000');
});
