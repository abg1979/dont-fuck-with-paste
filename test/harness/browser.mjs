import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  createExtensionStage,
  createStoredZip,
} from './extension.mjs';

export class BrowserUnavailableError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'BrowserUnavailableError';
  }
}

function executableCandidates() {
  const configured = process.env.FIREFOX_BIN;
  const platformCandidates = {
    darwin: ['/Applications/Firefox.app/Contents/MacOS/firefox'],
    win32: [
      path.join(process.env.PROGRAMFILES || '', 'Mozilla Firefox/firefox.exe'),
      path.join(process.env['PROGRAMFILES(X86)'] || '', 'Mozilla Firefox/firefox.exe'),
    ],
  };
  const fromPath = (process.env.PATH || '')
    .split(path.delimiter)
    .filter(Boolean)
    .map((directory) => path.join(directory, 'firefox'));

  return [
    ...(configured ? [configured] : []),
    ...(platformCandidates[process.platform] || []),
    ...fromPath,
  ].filter(Boolean);
}

async function findExecutable() {
  for (const candidate of executableCandidates()) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Try the next well-known browser location.
    }
  }
  return null;
}

let seleniumBindings;
async function loadSelenium() {
  if (!seleniumBindings) {
    seleniumBindings = Promise.all([
      import('selenium-webdriver'),
      import('selenium-webdriver/firefox.js'),
    ]).then(([selenium, firefox]) => ({ selenium, firefox }))
      .catch((error) => {
        if (
          error.code === 'ERR_MODULE_NOT_FOUND'
          && error.message.includes('selenium-webdriver')
        ) {
          throw new BrowserUnavailableError(
            'selenium-webdriver is not installed; add it as a dev dependency to run browser regressions',
            { cause: error },
          );
        }
        throw error;
      });
  }
  return seleniumBindings;
}

function unavailableDriverError(error) {
  const text = `${error.name || ''}: ${error.message || ''}`.toLowerCase();
  return [
    'nosuchdriver',
    'unable to obtain',
    'unable to find',
    'cannot find',
    'could not find',
    'driver executable',
    'binary is not a firefox executable',
  ].some((fragment) => text.includes(fragment));
}

export async function launchExtensionBrowser(browserName) {
  if (browserName !== 'firefox') {
    throw new Error(`Unsupported browser "${browserName}"`);
  }

  const executable = await findExecutable();
  if (!executable) {
    throw new BrowserUnavailableError(
      'Firefox executable not found; install it or set FIREFOX_BIN',
    );
  }

  const { selenium, firefox } = await loadSelenium();
  const stage = await createExtensionStage();
  let driver;

  try {
    const xpiPath = `${stage}.xpi`;
    await createStoredZip(stage, xpiPath);
    const options = new firefox.Options()
      .setBinary(executable);
    if (process.env.DFWP_HEADLESS !== '0') {
      options.addArguments('-headless');
    }
    driver = await new selenium.Builder()
      .forBrowser('firefox')
      .setFirefoxOptions(options)
      .build();
    await driver.installAddon(xpiPath, true);
    return {
      browserName,
      driver,
      selenium,
      stage,
      xpiPath,
    };
  } catch (error) {
    if (driver) {
      await driver.quit().catch(() => {});
    }
    if (unavailableDriverError(error)) {
      throw new BrowserUnavailableError(
        `${browserName} or its WebDriver is unavailable: ${error.message}`,
        { cause: error },
      );
    }
    throw error;
  }
}

export function selectedBrowsers() {
  return ['firefox'];
}

export const defaultTimeout = Number(process.env.DFWP_E2E_TIMEOUT_MS || 10_000);

export function platformDescription() {
  return `${os.platform()} ${os.arch()}`;
}
