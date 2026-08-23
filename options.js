import DFWP, { Rule, Rules, RuleView } from "./dfwp.js";
const { browser, storage } = DFWP;

let rules = new Rules();

async function displayRules(container) {
  while (container.firstChild) {
    container.removeChild(container.firstChild);
  }

  const { rules: values } = await storage.get({ rules: [] });
  rules = Rules.deserialize(values);
  rules.forEach((rule) => new RuleView(rule, rules).render(container));
}

document.addEventListener('DOMContentLoaded', () => {
  const container = document.querySelector('.container');
  const form = document.querySelector('.form');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    await storage.set({ rules: rules.serialize() });
  });

  document.querySelector('.add').addEventListener('click', () => {
    const rule = new Rule();
    rules.add(rule);
    new RuleView(rule, rules).render(container);
  });

  browser.storage.onChanged.addListener((changes) => {
    if (changes.rules) {
      displayRules(container);
    }
  });

  displayRules(container).catch((error) => {
    console.error('Failed to display rules', error);
  });
});
