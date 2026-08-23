import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import {
  access,
  copyFile,
  mkdir,
  readFile,
  readdir,
  rm,
  rmdir,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TEST_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const REPOSITORY_ROOT = path.resolve(TEST_ROOT, '..');
export const ARTIFACT_ROOT = path.join(TEST_ROOT, '.artifacts', String(process.pid));

export const CHROME_TEST_KEY =
  'MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDXcqKcduUhIt72A9srDKckTDFkXSn06TattHqnxkhGSHwn3PxrsL2KH3GqQD8VMb53zxtkrtpgGo83XmcmisOslpezK0RlcyOvoIVAunbLWrKWorFJ/gZOy+GuQOSWNFUCK+Xmxjzx6STb0xsDNTNeTPTvPdY2Rnwgo2WYsuysTwIDAQAB';
export const FIREFOX_EXTENSION_ID = 'DontFuckWithPaste@raim.ist';
export const FIREFOX_EXTENSION_UUID = '36fd9538-3a23-48c6-b30a-a9c5792d80b3';

const TEST_BRIDGE = `
document.addEventListener('__dfwp_test_storage_request', () => {
  const root = document.documentElement;
  const request = JSON.parse(root.getAttribute('data-dfwp-test-request'));
  const respond = (payload) => {
    root.setAttribute('data-dfwp-test-response', JSON.stringify({
      requestId: request.requestId,
      ...payload,
    }));
    document.dispatchEvent(new Event('__dfwp_test_storage_response'));
  };

  chrome.storage.sync.set({ rules: request.rules }, () => {
    if (chrome.runtime.lastError) {
      respond({ error: chrome.runtime.lastError.message });
      return;
    }
    chrome.storage.sync.get({ rules: [] }, ({ rules }) => respond({ rules }));
  });
});
`;

const EXTENSION_FILES = [
  'background-controller.mjs',
  'background.js',
  'clipboard-active-128.png',
  'clipboard-active-32.png',
  'clipboard-active-48.png',
  'clipboard-active.png',
  'clipboard-inactive-128.png',
  'clipboard-inactive-32.png',
  'clipboard-inactive-48.png',
  'clipboard-inactive.png',
  'content.js',
  'dfwp.js',
  'manifest.json',
  'options.html',
  'options.js',
  'popup.html',
  'popup.js',
  'rules.mjs',
  'styles.css',
];

export function chromeExtensionId(key = CHROME_TEST_KEY) {
  const digest = createHash('sha256')
    .update(Buffer.from(key, 'base64'))
    .digest()
    .subarray(0, 16);

  return [...digest]
    .flatMap((byte) => [byte >> 4, byte & 0x0f])
    .map((nibble) => String.fromCharCode('a'.charCodeAt(0) + nibble))
    .join('');
}

export async function createExtensionStage(browserName) {
  const stage = path.join(
    ARTIFACT_ROOT,
    `${browserName}-${Date.now()}`,
  );
  await mkdir(stage, { recursive: true });

  await Promise.all(EXTENSION_FILES.map(async (file) => {
    const source = path.join(REPOSITORY_ROOT, file);
    await access(source, constants.R_OK);
    await copyFile(source, path.join(stage, file));
  }));

  const manifestPath = path.join(stage, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.content_scripts[0].js.push('test-storage-bridge.js');
  await writeFile(path.join(stage, 'test-storage-bridge.js'), TEST_BRIDGE);

  if (browserName === 'chrome') {
    manifest.key = CHROME_TEST_KEY;
  }
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  return stage;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zipLocalHeader(name, data, crc) {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(0x21, 12);
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(data.length, 18);
  header.writeUInt32LE(data.length, 22);
  header.writeUInt16LE(Buffer.byteLength(name), 26);
  header.writeUInt16LE(0, 28);
  return header;
}

function zipCentralHeader(name, data, crc, offset) {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(0, 12);
  header.writeUInt16LE(0x21, 14);
  header.writeUInt32LE(crc, 16);
  header.writeUInt32LE(data.length, 20);
  header.writeUInt32LE(data.length, 24);
  header.writeUInt16LE(Buffer.byteLength(name), 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(offset, 42);
  return header;
}

export async function createStoredZip(sourceDirectory, outputPath) {
  const names = (await readdir(sourceDirectory, { recursive: true }))
    .filter((name) => !name.endsWith(path.sep))
    .sort();
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const nativeName of names) {
    const statPath = path.join(sourceDirectory, nativeName);
    const data = await readFile(statPath).catch((error) => {
      if (error.code === 'EISDIR') {
        return null;
      }
      throw error;
    });
    if (data === null) {
      continue;
    }

    const name = nativeName.split(path.sep).join('/');
    const nameBuffer = Buffer.from(name);
    const crc = crc32(data);
    const localHeader = zipLocalHeader(name, data, crc);
    localParts.push(localHeader, nameBuffer, data);
    centralParts.push(zipCentralHeader(name, data, crc, offset), nameBuffer);
    offset += localHeader.length + nameBuffer.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  const entryCount = centralParts.length / 2;
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entryCount, 8);
  end.writeUInt16LE(entryCount, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  await writeFile(outputPath, Buffer.concat([...localParts, centralDirectory, end]));
  return outputPath;
}

export async function removeArtifacts() {
  if (process.env.DFWP_KEEP_TEST_ARTIFACTS !== '1') {
    await rm(ARTIFACT_ROOT, { recursive: true, force: true });
    await rmdir(path.dirname(ARTIFACT_ROOT)).catch((error) => {
      if (!['ENOENT', 'ENOTEMPTY'].includes(error.code)) {
        throw error;
      }
    });
  }
}
