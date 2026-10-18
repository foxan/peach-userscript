import { chromium, type Browser } from 'playwright-core';

export const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'mobile', width: 390, height: 844 },
] as const;

export async function launch(): Promise<Browser> {
  return chromium.launch({
    headless: true,
    ...(process.env.PEACH_E2E_CHROME ? { executablePath: process.env.PEACH_E2E_CHROME } : {}),
    timeout: 60_000,
  });
}
