import { expect, test } from '@playwright/test';
import { readdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

test('activities page renders the MongoDB catalog without changing the existing card UI', async ({
  page,
}) => {
  const catalogResponse = page.waitForResponse(
    (response) =>
      response.url().includes('/api/v1/catalog/activities') && response.status() === 200,
  );

  await page.goto('http://localhost:3000/activities');
  const response = await catalogResponse;
  const payload = await response.json();

  expect(payload.pagination.total).toBe(220);
  await expect(page.locator('.at-count')).toContainText('220 results found');
  await expect(page.locator('.activity-results-grid .ac-card')).toHaveCount(12);
  await expect(page.locator('.activity-page-heading .section-title')).toContainText('Trip Search');
  await expect(page.locator('.activity-results-grid .ac-card').first()).toBeVisible();
});

test('all frontend images are streamed from MongoDB GridFS', async ({ request }) => {
  const imageDirectory = resolve(process.cwd(), '../Tourvex-NextJS/public/images');
  const filenames = await readdir(imageDirectory);

  for (const filename of filenames) {
    const expectedSize = (await stat(resolve(imageDirectory, filename))).size;
    const response = await request.get(
      `http://localhost:3000/images/${encodeURIComponent(filename)}`,
    );

    expect(response.ok(), filename).toBeTruthy();
    expect(response.headers()['content-type'], filename).toMatch(/^image\//);
    expect(response.headers()['x-tourvex-media-source'], filename).toBe('mongodb-gridfs');
    expect((await response.body()).byteLength, filename).toBe(expectedSize);
  }
});
