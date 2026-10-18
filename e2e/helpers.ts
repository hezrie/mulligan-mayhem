// Shared e2e helpers. Same behaviour as the private screenshot helper in skeleton-hole.spec.ts.
import { join } from 'node:path';
import type { Page, TestInfo } from '@playwright/test';

/** Saves test-results/screenshots/<project>-<name>.png and attaches it to the report. */
export async function screenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const path = join('test-results', 'screenshots', `${testInfo.project.name}-${name}.png`);
  await page.screenshot({ path, fullPage: true });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}
