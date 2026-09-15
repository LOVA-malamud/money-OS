import { defineConfig } from '@playwright/test';
export default defineConfig({testDir:'./tests/pwa',outputDir:'.local/pwa-results',workers:1,timeout:45000,reporter:'list',use:{browserName:'chromium',trace:'off',screenshot:'only-on-failure'}});
