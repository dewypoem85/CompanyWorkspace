import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir:'tooling/browser-tests',
  fullyParallel:true,
  forbidOnly:!!process.env.CI,
  retries:0,
  workers:2,
  reporter:'list',
  outputDir:'artifacts/browser',
  use:{
    browserName:'chromium',
    channel:process.env.WORKSPACE_BROWSER_CHANNEL || undefined,
    headless:true,
    trace:'retain-on-failure'
  }
});
