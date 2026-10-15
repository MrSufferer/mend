import {defineConfig} from '@playwright/test';
export default defineConfig({
 testDir:'./tests/recovery',testMatch:['lifecycle.spec.ts','browser.spec.ts','health.spec.ts'],workers:1,fullyParallel:false,
 timeout:180000,globalTimeout:1800000,retries:0,forbidOnly:true,
 reporter:'line',outputDir:'test-results/recovery',
 use:{trace:'off',screenshot:'off',video:'off'},
});
