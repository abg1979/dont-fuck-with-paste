import { Rules } from './rules.mjs';

const NO_RECEIVER_MESSAGES = [
  'Could not establish connection',
  'Cannot access contents of url',
  'Receiving end does not exist',
  'No matching message handler',
  'The extensions gallery cannot be scripted',
];

export class BackgroundController {
  constructor(browser, storage, logger = console) {
    this.browser = browser;
    this.storage = storage;
    this.logger = logger;
    this.rules = new Rules();
    this.reportedInvalidRules = new Set();
    this.ruleLoadGeneration = 0;
    this.rulesReady = this.refreshRules();
  }

  async loadRules(generation) {
    const { rules = [] } = await this.storage.get({ rules: [] });

    if (generation !== this.ruleLoadGeneration) {
      return this.rules;
    }

    this.rules = Rules.deserialize(rules);
    this.reportedInvalidRules.clear();
    return this.rules;
  }

  reportInvalidRule(rule, error) {
    if (!this.reportedInvalidRules.has(rule.value)) {
      this.reportedInvalidRules.add(rule.value);
      this.logger.error(`Ignoring invalid regular expression "${rule.value}"`, error);
    }
  }

  async checkIfActive(tabId) {
    await this.rulesReady;

    let tab;
    try {
      tab = await this.browser.tabs.get(tabId);
    } catch (error) {
      this.logger.debug(`Tab ${tabId} disappeared before its state could be updated`, error);
      return false;
    }

    const active = this.rules.matching(
      tab.url || '',
      this.reportInvalidRule.bind(this),
    ).length > 0;

    await Promise.all([
      this.browser.action.setIcon({
        tabId,
        path: active ? 'clipboard-active-32.png' : 'clipboard-inactive-32.png',
      }),
      this.browser.action.setTitle({
        tabId,
        title: `Don't F*** With Paste (${active ? 'active' : 'inactive'})`,
      }),
    ]);

    try {
      await this.browser.tabs.sendMessage(tabId, { active });
    } catch (error) {
      if (NO_RECEIVER_MESSAGES.some((message) => error.message?.includes(message))) {
        this.logger.debug(`No content script is available in tab ${tabId}`, error);
      } else {
        throw error;
      }
    }

    return active;
  }

  async refreshRules() {
    const generation = ++this.ruleLoadGeneration;
    this.rulesReady = this.loadRules(generation);
    await this.rulesReady;
  }

  async refreshAllTabs() {
    const tabs = await this.browser.tabs.query({});
    await Promise.all(tabs.map(({ id }) => this.checkIfActive(id)));
  }

  register() {
    this.browser.runtime.onMessage.addListener((message, sender) => {
      if (!message?.didLoad || sender.tab?.id === undefined) {
        return undefined;
      }

      return this.checkIfActive(sender.tab.id);
    });

    this.browser.storage.onChanged.addListener((changes) => {
      if (!changes.rules) {
        return;
      }

      this.refreshRules()
        .then(() => this.refreshAllTabs())
        .catch((error) => this.logger.error('Failed to apply updated rules', error));
    });

    this.browser.tabs.onActivated.addListener(({ tabId }) => {
      this.checkIfActive(tabId)
        .catch((error) => this.logger.error(`Failed to update tab ${tabId}`, error));
    });

    this.browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
      if (!changeInfo.url && changeInfo.status !== 'loading') {
        return;
      }

      this.checkIfActive(tabId)
        .catch((error) => this.logger.error(`Failed to update tab ${tabId}`, error));
    });
  }
}
