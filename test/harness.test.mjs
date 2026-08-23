import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { after, test } from 'node:test';
import {
  ARTIFACT_ROOT,
  CHROME_TEST_KEY,
  chromeExtensionId,
  createExtensionStage,
  createStoredZip,
  removeArtifacts,
} from './harness/extension.mjs';
import { startFixtureServer } from './harness/server.mjs';

after(removeArtifacts);

test('fixture server exposes deterministic blocker pages without caching', async () => {
  const server = await startFixtureServer();
  try {
    const response = await fetch(server.url('/configured.html'));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.match(await response.text(), /early-capture/);

    const missing = await fetch(server.url('/missing'));
    assert.equal(missing.status, 404);
  } finally {
    await server.close();
  }
});

test('Chrome staging pins the expected extension id without changing source', async () => {
  const stage = await createExtensionStage('chrome');
  const manifest = JSON.parse(
    await readFile(path.join(stage, 'manifest.json'), 'utf8'),
  );
  assert.equal(manifest.key, CHROME_TEST_KEY);
  assert.equal(chromeExtensionId(), 'mabjlkkcenppomhcdccgeciocjlaoohl');
});

test('Firefox staging can be packaged as an installable ZIP container', async () => {
  const stage = await createExtensionStage('firefox');
  const output = path.join(ARTIFACT_ROOT, 'extension.xpi');
  await createStoredZip(stage, output);
  const archive = await readFile(output);

  assert.equal(archive.readUInt32LE(0), 0x04034b50);
  assert.equal(
    archive.readUInt32LE(archive.length - 22),
    0x06054b50,
  );
  await rm(output, { force: true });
});
