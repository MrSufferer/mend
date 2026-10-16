import {test,expect} from '@playwright/test';

test('public recovery story shows illustrative evidence with keyboard focus return',async({page})=>{
 const privateRequests:string[]=[];
 page.on('request',request=>{if(new URL(request.url()).pathname==='/api/orders')privateRequests.push(request.url());});
 await page.goto('/');
 await expect(page.getByText('Mend resolves failed paid jobs for API businesses.',{exact:false})).toBeVisible();
 await expect(page.getByRole('article',{name:'Sample recovered order'})).toBeVisible();
 await expect(page.getByText('Illustrative records, not a live customer incident.',{exact:false})).toBeVisible();
 const opener=page.getByRole('button',{name:'See a recovery',exact:true});
 await opener.focus();await page.keyboard.press('Enter');
 const dialog=page.getByRole('dialog',{name:'How access was restored'});
 await expect(dialog).toBeVisible();
 await expect(dialog).toContainText('Customer download is unverified');
 await page.keyboard.press('Tab');expect(await dialog.evaluate(element=>element.contains(document.activeElement))).toBe(true);
 await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(opener).toBeFocused();
 expect(privateRequests).toEqual([]);
 await expect(page.getByRole('navigation',{name:'Prototype variants'})).toHaveCount(0);
});

test('conversion and private orders have distinct destinations and contextual access',async({page})=>{
 await page.goto('/');await page.getByRole('link',{name:'Convert',exact:true}).click();
 await expect(page).toHaveURL(/\/convert$/);
 await expect(page.getByLabel('Choose a PDF',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Connect wallet',exact:true})).toBeVisible();
 await expect(page.getByRole('link',{name:'Convert',exact:true})).toHaveAttribute('aria-current','page');
 await page.getByRole('link',{name:'My orders',exact:true}).click();
 await expect(page).toHaveURL(/\/orders$/);
 await expect(page.getByRole('heading',{name:'Sign in to view private orders',exact:true})).toBeVisible();
 await expect(page.getByLabel('Choose a PDF',{exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Use sample PDF',exact:true})).toHaveCount(0);
});
