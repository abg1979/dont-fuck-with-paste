const DFWP = {};

try {
  DFWP.browser = browser;
} catch {
  DFWP.browser = chrome;
}

if (DFWP.browser.storage.sync) {
  DFWP.storage = DFWP.browser.storage.sync;
} else {
  DFWP.storage = DFWP.browser.storage.local;
}

export default DFWP;

export { Rule, Rules } from './rules.mjs';

export class RuleView {
  constructor(rule, rules) {
    this.rule = rule;
    this.rules = rules;
  }

  onclick(event) {
    this.rules.delete(this.rule);
    event.target.parentNode.remove();
  }

  oninput(event) {
    this.rule.value = event.target.value;
    this.validate(event.target);
  }

  render(container, templateSelector = '#template') {
    const clone = document.importNode(this.template(templateSelector).content, true);
    const input = clone.querySelector('.input');
    input.value = this.rule.value;
    this.validate(input);
    input.addEventListener('input', this.oninput.bind(this));

    const button = clone.querySelector('.delete');
    if (button) {
      button.addEventListener('click', this.onclick.bind(this));
    }

    container.appendChild(clone);
  }

  template(templateSelector) {
    return document.querySelector(templateSelector);
  }

  validate(input) {
    const error = this.rule.error;
    const message = error ? `Invalid regular expression: ${error.message}` : '';
    input.setCustomValidity(message);
    input.title = message;
    if (error) {
      input.setAttribute('aria-invalid', 'true');
    } else {
      input.removeAttribute('aria-invalid');
    }
  }
}
