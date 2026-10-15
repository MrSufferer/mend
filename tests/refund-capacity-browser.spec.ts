import {test,expect} from '@playwright/test';
import {wallet} from './wallet-fixture';
test('operator sees private stale capacity evidence without overflow at supported widths',async({page})=>{
 await wallet(page,2);await page.goto('/recovery');
 await page.getByRole('button',{name:'Connect wallet',exact:true}).click();
 await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Aggregate refund capacity'})).toBeVisible();
 await expect(page.getByText('Capacity evidence stale',{exact:true})).toBeVisible();
 await expect(page.getByText('Backlog version · observed version',{exact:true})).toBeVisible();
 await expect(page.getByText('Observed reserve balance',{exact:true})).toBeVisible();
 await expect(page.getByText('Next UTC allowance reset',{exact:true})).toBeVisible();
 for(const width of [375,768,1280]){await page.setViewportSize({width,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);}
});
