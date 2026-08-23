import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import {
  BrowserUnavailableError,
  defaultTimeout,
  launchExtensionBrowser,
  platformDescription,
  selectedBrowsers,
} from './harness/browser.mjs';
import { removeArtifacts } from './harness/extension.mjs';
import { startFixtureServer } from './harness/server.mjs';

const eventTypes = ['copy', 'cut', 'paste'];
const blockerTypes = ['inline', 'listener', 'property', 'early-capture'];
const server = await startFixtureServer();

after(async () => {
  await server.close();
  await removeArtifacts();
});

function configuredPattern() {
  return `^${server.origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:/configured\\.html|/navigation/configured\\.html)$`;
}

async function extensionRequest(environment, request) {
  return environment.driver.executeAsyncScript(`
    const request = arguments[0];
    const done = arguments[arguments.length - 1];
    const requestId = crypto.randomUUID();
    const root = document.documentElement;
    const timeout = setTimeout(
      () => done({ error: 'Timed out waiting for the extension storage bridge' }),
      5000,
    );
    const receive = () => {
      const response = JSON.parse(root.getAttribute('data-dfwp-test-response'));
      if (response.requestId !== requestId) return;
      document.removeEventListener('__dfwp_test_storage_response', receive);
      clearTimeout(timeout);
      done(response);
    };
    document.addEventListener('__dfwp_test_storage_response', receive);
    root.setAttribute(
      'data-dfwp-test-request',
      JSON.stringify({ requestId, ...request }),
    );
    document.dispatchEvent(new Event('__dfwp_test_storage_request'));
  `, request);
}

async function setRules(environment, rules) {
  await environment.driver.get(server.url('/unconfigured.html'));
  await waitForFixture(environment);
  const response = await extensionRequest(environment, {
    action: 'setRules',
    rules,
  });
  assert.equal(response.error, undefined, `storage update failed: ${response.error}`);
  assert.deepEqual(response.rules, rules);
}

async function waitForFixture(environment) {
  await environment.driver.wait(
    () => environment.driver.executeScript('return window.fixtureReady === true'),
    defaultTimeout,
    'fixture scripts did not become ready',
  );
}

async function probe(environment, eventType, blocker) {
  return environment.driver.executeScript(
    'return window.runProbe(arguments[0], arguments[1])',
    eventType,
    blocker,
  );
}

async function waitForCancellationState(
  environment,
  eventType,
  blocker,
  defaultPrevented,
) {
  let result;
  await environment.driver.wait(async () => {
    result = await probe(environment, eventType, blocker);
    return result.defaultPrevented === defaultPrevented;
  }, defaultTimeout, `extension did not reach the expected ${eventType} state`);
  return result;
}

async function assertAllBlockers(environment, expectedPrevented) {
  for (const eventType of eventTypes) {
    for (const blocker of blockerTypes) {
      const result = await waitForCancellationState(
        environment,
        eventType,
        blocker,
        expectedPrevented,
      );
      assert.equal(
        result.dispatchReturned,
        !expectedPrevented,
        `${eventType}/${blocker}: dispatch result`,
      );
      assert.equal(
        result.siteHitCount,
        expectedPrevented ? 1 : 0,
        `${eventType}/${blocker}: site blocker invocation`,
      );
    }
  }
}

for (const browserName of selectedBrowsers()) {
  describe(`${browserName} extension regressions`, { concurrency: false }, () => {
    let environmentPromise;
    let environment;

    async function requireBrowser(context) {
      environmentPromise ||= launchExtensionBrowser(browserName);
      try {
        environment = await environmentPromise;
        return environment;
      } catch (error) {
        if (error instanceof BrowserUnavailableError) {
          if (process.env.DFWP_REQUIRE_BROWSERS === '1') {
            throw error;
          }
          context.skip(`${error.message} (${platformDescription()})`);
          return null;
        }
        throw error;
      }
    }

    after(async () => {
      if (environment?.driver) {
        await environment.driver.quit();
      }
    });

    test('configured pages bypass all clipboard cancellation styles', async (context) => {
      const current = await requireBrowser(context);
      if (!current) return;

      await setRules(current, [configuredPattern()]);
      await current.driver.get(server.url('/configured.html'));
      await waitForFixture(current);
      await assertAllBlockers(current, false);
    });

    test('unconfigured pages retain all clipboard cancellation styles', async (context) => {
      const current = await requireBrowser(context);
      if (!current) return;

      await setRules(current, [configuredPattern()]);
      await current.driver.get(server.url('/unconfigured.html'));
      await waitForFixture(current);
      await assertAllBlockers(current, true);
    });

    test('iframe state follows the configured top-level page', async (context) => {
      const current = await requireBrowser(context);
      if (!current) return;

      await setRules(current, [configuredPattern()]);
      for (const [pathname, expectedPrevented] of [
        ['/configured.html', false],
        ['/unconfigured.html', true],
      ]) {
        await current.driver.get(server.url(pathname));
        await waitForFixture(current);
        const frame = await current.driver.findElement(
          current.selenium.By.css('#fixture-frame'),
        );
        await current.driver.switchTo().frame(frame);
        try {
          await waitForFixture(current);
          await assertAllBlockers(current, expectedPrevented);
        } finally {
          await current.driver.switchTo().defaultContent();
        }
      }
    });

    test('navigation re-evaluates activation without duplicate listeners', async (context) => {
      const current = await requireBrowser(context);
      if (!current) return;

      await setRules(current, [configuredPattern()]);
      for (const [pathname, expectedPrevented] of [
        ['/navigation/configured.html', false],
        ['/navigation/unconfigured.html', true],
        ['/navigation/configured.html', false],
      ]) {
        await current.driver.get(server.url(pathname));
        await waitForFixture(current);
        const result = await waitForCancellationState(
          current,
          'paste',
          'listener',
          expectedPrevented,
        );
        assert.equal(result.siteHitCount, expectedPrevented ? 1 : 0);
      }
    });

    test('tabs and windows retain independent activation state', async (context) => {
      const current = await requireBrowser(context);
      if (!current) return;

      await setRules(current, [configuredPattern()]);
      await current.driver.get(server.url('/configured.html'));
      await waitForFixture(current);
      const configuredWindow = await current.driver.getWindowHandle();
      await current.driver.switchTo().newWindow('window');
      const unconfiguredWindow = await current.driver.getWindowHandle();

      try {
        await current.driver.get(server.url('/unconfigured.html'));
        await waitForFixture(current);
        await waitForCancellationState(current, 'paste', 'listener', true);

        await current.driver.switchTo().window(configuredWindow);
        await waitForCancellationState(current, 'paste', 'listener', false);

        const { actionStates } = await extensionRequest(current, {
          action: 'getActionStates',
        });
        assert.deepEqual(
          actionStates
            .filter(({ url }) => url.startsWith(server.origin))
            .map(({ url, title }) => [new URL(url).pathname, title])
            .sort(([left], [right]) => left.localeCompare(right)),
          [
            ['/configured.html', "Don't F*** With Paste (active)"],
            ['/unconfigured.html', "Don't F*** With Paste (inactive)"],
          ],
        );
      } finally {
        await current.driver.switchTo().window(unconfiguredWindow);
        await current.driver.close();
        await current.driver.switchTo().window(configuredWindow);
      }
    });

    test('malformed stored rules are contained and shown as invalid', async (context) => {
      const current = await requireBrowser(context);
      if (!current) return;

      await setRules(current, ['[', configuredPattern()]);
      await current.driver.get(server.url('/configured.html'));
      await waitForFixture(current);
      const result = await waitForCancellationState(
        current,
        'paste',
        'property',
        false,
      );
      assert.equal(result.siteHitCount, 0, 'valid rules still activate the page');

      const handlesBefore = new Set(await current.driver.getAllWindowHandles());
      const response = await extensionRequest(current, { action: 'openOptions' });
      assert.equal(response.opened, true);
      const optionsWindow = await current.driver.wait(async () => {
        const handles = await current.driver.getAllWindowHandles();
        return handles.find((handle) => !handlesBefore.has(handle)) || false;
      }, defaultTimeout, 'options page did not open');
      await current.driver.switchTo().window(optionsWindow);
      const invalidInput = await current.driver.wait(async () => {
        const inputs = await current.driver.findElements(
          current.selenium.By.css('.input'),
        );
        for (const input of inputs) {
          if (await input.getAttribute('value') === '[') {
            return input;
          }
        }
        return false;
      }, defaultTimeout, 'invalid stored rule was not rendered');

      assert.equal(await invalidInput.getAttribute('aria-invalid'), 'true');
      const validationMessage = await current.driver.executeScript(
        'return arguments[0].validationMessage',
        invalidInput,
      );
      assert.match(validationMessage, /invalid regular expression/i);
    });
  });
}
