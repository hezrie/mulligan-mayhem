import { generateHole } from '../src/core/course/generator.ts';
import { hashHole } from '../src/core/hash.ts';
import { expect, test } from './fixtures.ts';

test('generated hole for seed 12345, index 0 hashes the same in the browser as in Node', async ({
  page,
}) => {
  const node = hashHole(generateHole(12345, 0));
  await page.goto('./');
  await page.waitForFunction(() => window.__MM__?.ready === true);
  const browser = await page.evaluate(() => window.__MM__!.getGeneratedHoleHash(12345, 0));
  expect(browser).toBe(node);
});
