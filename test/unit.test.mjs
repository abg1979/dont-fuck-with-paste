import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { BackgroundController } from '../background-controller.mjs';
import { Rule, Rules } from '../rules.mjs';

function deferred() {
  let resolve;
  const promise = new Promise((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function event() {
  return {
    listener: undefined,
    addListener(listener) {
      this.listener = listener;
    },
  };
}

function browserFixture(url = 'https://example.com/form') {
  const calls = [];
  const browser = {
    action: {
      async setIcon(details) {
        calls.push(['icon', details]);
      },
      async setTitle(details) {
        calls.push(['title', details]);
      },
    },
    runtime: { onMessage: event() },
    storage: { onChanged: event() },
    tabs: {
      onActivated: event(),
      onUpdated: event(),
      async get(id) {
        return { id, url };
      },
      async query() {
        return [];
      },
      async sendMessage(id, message) {
        calls.push(['message', { id, ...message }]);
      },
    },
  };
  return { browser, calls };
}

describe('rules', () => {
  test('escapes generated origins and caches valid patterns', () => {
    const value = Rule.escape('https://[::1]:8080');
    const rule = new Rule(value);

    assert.equal(value, 'https://\\[::1\\]:8080');
    assert.equal(rule.valid, true);
    assert.equal(rule.test('https://[::1]:8080/form'), true);
    assert.equal(rule.compile(), rule.compile());
  });

  test('contains malformed and empty stored rules', () => {
    const rules = Rules.deserialize(['[', '', 'example\\.com']);
    const invalid = [];

    assert.deepEqual(
      rules.matching('https://example.com', (rule, error) => {
        invalid.push([rule.value, error.name]);
      }).map((rule) => rule.value),
      ['example\\.com'],
    );
    assert.deepEqual(invalid, [['[', 'SyntaxError']]);
    assert.deepEqual(rules.serialize(), ['[', 'example\\.com']);
  });

  test('treats malformed storage values as an empty rule set', () => {
    assert.deepEqual(Rules.deserialize(null).serialize(), []);
    assert.deepEqual(Rules.deserialize({ rules: [] }).serialize(), []);
  });
});

describe('background controller', () => {
  test('waits for rules and scopes state to the sender tab', async () => {
    const storageRead = deferred();
    const { browser, calls } = browserFixture();
    const storage = {
      async get() {
        return storageRead.promise;
      },
    };
    const controller = new BackgroundController(browser, storage);
    controller.register();

    const activation = browser.runtime.onMessage.listener(
      { didLoad: true },
      { tab: { id: 42 } },
    );
    await Promise.resolve();
    assert.deepEqual(calls, []);

    storageRead.resolve({ rules: ['example\\.com'] });
    assert.equal(await activation, true);
    assert.equal(calls[0][1].tabId, 42);
    assert.equal(calls[1][1].tabId, 42);
    assert.deepEqual(calls[2], ['message', { id: 42, active: true }]);
  });

  test('keeps valid rules active when stored rules include malformed entries', async () => {
    const errors = [];
    const { browser } = browserFixture();
    const controller = new BackgroundController(
      browser,
      { async get() { return { rules: ['[', 'example\\.com'] }; } },
      {
        debug() {},
        error(...args) {
          errors.push(args);
        },
      },
    );

    assert.equal(await controller.checkIfActive(7), true);
    assert.equal(errors.length, 1);
    assert.match(errors[0][0], /invalid regular expression/i);
  });

  test('ignores non-content messages and rechecks navigation', async () => {
    const { browser, calls } = browserFixture('https://unconfigured.test');
    const controller = new BackgroundController(
      browser,
      { async get() { return { rules: [] }; } },
    );
    controller.register();

    assert.equal(
      browser.runtime.onMessage.listener({ didLoad: true }, {}),
      undefined,
    );
    browser.tabs.onUpdated.listener(9, { title: 'unchanged' });
    await Promise.resolve();
    assert.deepEqual(calls, []);

    browser.tabs.onUpdated.listener(9, { status: 'loading' });
    await controller.rulesReady;
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls[0][1].tabId, 9);
    assert.equal(calls[2][1].active, false);
  });
});
