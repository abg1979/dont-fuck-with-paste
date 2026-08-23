import DFWP, { Rule, Rules, RuleView } from "./dfwp.js";
const { browser, storage } = DFWP;

document.addEventListener('DOMContentLoaded', async () => {
  const add = document.querySelector('.add');
  const cancel = document.querySelector('.cancel');
  const container = document.querySelector('.container');
  const form = document.querySelector('.form');
  const options = document.querySelector('.options');
  let rules = new Rules();

  form.addEventListener('submit', async event => {
    event.preventDefault();
    await storage.set({ rules: rules.serialize() });
    window.close();
  });

  cancel.addEventListener('click', () => {
    window.close();
  });

  options.addEventListener('click', () => {
    browser.runtime.openOptionsPage();
  });

  const { rules: values } = await storage.get({ rules: [] });
  rules = Rules.deserialize(values);

  const [tab] = await browser.tabs.query({
    active: true,
    windowId: browser.windows.WINDOW_ID_CURRENT,
  });
  const addHandler = () => {
    const rule = new Rule(Rule.escape(new URL(tab.url).origin));
    rules.add(rule);
    new RuleView(rule, rules).render(container, '#new');
  };

  add.addEventListener('click', addHandler);

  const matching = rules.matching(tab.url);
  matching.forEach(rule => new RuleView(rule, rules).render(container, '#existing'));

  if (!matching.length) {
    addHandler();
  }

  const remove = document.querySelector('.delete');
  if (remove) {
    remove.addEventListener('click', async () => {
      await storage.set({ rules: rules.serialize() });
      window.close();
    });
  }

});
