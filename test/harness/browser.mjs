import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  CHROME_TEST_KEY,
  FIREFOX_EXTENSION_ID,
  FIREFOX_EXTENSION_UUID,
  chromeExtensionId,
  createExtensionStage,
  createStoredZip,
} from './extension.mjs';

export class BrowserUnavailableError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'BrowserUnavailableError';
  }
}

function executableCandidates(browserName) {
  const environmentName = browserName === 'chrome' ? 'CHROME_BIN' : 'FIREFOX_BIN';
  const configured = process.env[environmentName];
  const pathNames = browserName === 'chrome'
    ? ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'chrome']
    : ['firefox'];
  const platformCandidates = {
    darwin: browserName === 'chrome'
      ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
      : ['/Applications/Firefox.app/Contents/MacOS/firefox'],
    win32: browserName === 'chrome'
      ? [
          path.join(process.env.PROGRAMFILES || '', 'Google/Chrome/Application/chrome.exe'),
          path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google/Chrome/Application/chrome.exe'),
          path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
        ]
      : [
          path.join(process.env.PROGRAMFILES || '', 'Mozilla Firefox/firefox.exe'),
          path.join(process.env['PROGRAMFILES(X86)'] || '', 'Mozilla Firefox/firefox.exe'),
        ],
  };
  const fromPath = (process.env.PATH || '')
    .split(path.delimiter)
    .filter(Boolean)
    .flatMap((directory) => pathNames.map((name) => path.join(directory, name)));

  return [
    ...(configured ? [configured] : []),
    ...(platformCandidates[process.platform] || []),
    ...fromPath,
  ].filter(Boolean);
}

async function findExecutable(browserName) {
  for (const candidate of executableCandidates(browserName)) {
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
      import('selenium-webdriver/chrome.js'),
      import('selenium-webdriver/firefox.js'),
    ]).then(([selenium, chrome, firefox]) => ({ selenium, chrome, firefox }))
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
    'cannot find chrome binary',
    'chrome binary not found',
  ].some((fragment) => text.includes(fragment));
}

export async function launchExtensionBrowser(browserName) {
  if (!['chrome', 'firefox'].includes(browserName)) {
    throw new Error(`Unsupported browser "${browserName}"`);
  }

  const executable = await findExecutable(browserName);
  if (!executable) {
    const variable = browserName === 'chrome' ? 'CHROME_BIN' : 'FIREFOX_BIN';
    throw new BrowserUnavailableError(
      `${browserName} executable not found; install it or set ${variable}`,
    );
  }

  const { selenium, chrome, firefox } = await loadSelenium();
  const stage = await createExtensionStage(browserName);
  let driver;

  try {
    const builder = new selenium.Builder().forBrowser(browserName);
    if (browserName === 'chrome') {
      const options = new chrome.Options()
        .setChromeBinaryPath(executable)
        .addArguments(
          `--disable-extensions-except=${stage}`,
          `--load-extension=${stage}`,
          '--disable-default-apps',
          '--no-first-run',
        );
      if (process.env.DFWP_HEADLESS !== '0') {
        options.addArguments('--headless=new');
      }
      driver = await builder.setChromeOptions(options).build();
      const extensionOptionsUrl =
        `chrome-extension://${chromeExtensionId(CHROME_TEST_KEY)}/options.html`;
      await driver.get(extensionOptionsUrl);
      const extensionLoaded = await driver.executeScript(
        'return Boolean(document.querySelector(".form"))',
      );
      if (!extensionLoaded) {
        await driver.quit();
        throw new BrowserUnavailableError(
          'this Chrome build does not load unpacked extensions; set CHROME_BIN to Chrome for Testing',
        );
      }
      return {
        browserName,
        canOpenExtensionPages: true,
        driver,
        extensionOptionsUrl,
        selenium,
        stage,
      };
    }

    const xpiPath = `${stage}.xpi`;
    await createStoredZip(stage, xpiPath);
    const options = new firefox.Options()
      .setBinary(executable)
      .setPreference(
        'extensions.webextensions.uuids',
        JSON.stringify({ [FIREFOX_EXTENSION_ID]: FIREFOX_EXTENSION_UUID }),
      );
    if (process.env.DFWP_HEADLESS !== '0') {
      options.addArguments('-headless');
    }
    driver = await builder.setFirefoxOptions(options).build();
    await driver.installAddon(xpiPath, true);
    return {
      browserName,
      canOpenExtensionPages: false,
      driver,
      extensionOptionsUrl:
        `moz-extension://${FIREFOX_EXTENSION_UUID}/options.html`,
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
  const requested = (process.env.DFWP_E2E_BROWSERS || 'chrome,firefox')
    .split(',')
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set(requested)];
}

export const defaultTimeout = Number(process.env.DFWP_E2E_TIMEOUT_MS || 10_000);

export function platformDescription() {
  return `${os.platform()} ${os.arch()}`;
}
