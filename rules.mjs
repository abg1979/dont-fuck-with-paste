export class Rule {
  constructor(value) {
    this.value = value || '';
    this.compiledValue = undefined;
    this.compiledPattern = undefined;
    this.compilationError = undefined;
  }

  static escape(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  compile() {
    if (this.compiledValue !== this.value) {
      this.compiledValue = this.value;
      this.compiledPattern = undefined;
      this.compilationError = undefined;

      try {
        this.compiledPattern = new RegExp(this.value || '(?=a)b');
      } catch (error) {
        this.compilationError = error;
      }
    }

    if (this.compilationError) {
      throw this.compilationError;
    }

    return this.compiledPattern;
  }

  get error() {
    try {
      this.compile();
      return null;
    } catch (error) {
      return error;
    }
  }

  get valid() {
    return !this.error;
  }

  test(string) {
    return this.compile().test(string);
  }
}

export class Rules extends Set {
  static get [Symbol.species]() { return Set; }

  static deserialize(values) {
    const serializedRules = Array.isArray(values) ? values : [];
    return new Rules(serializedRules.map((value) => new Rule(value)));
  }

  get array() {
    return Array.from(this);
  }

  filter(cb) {
    return this.array.filter(cb);
  }

  find(cb) {
    return this.array.find(cb);
  }

  matching(string, onInvalid) {
    return this.filter((rule) => {
      if (!rule.valid) {
        onInvalid?.(rule, rule.error);
        return false;
      }

      return rule.test(string);
    });
  }

  serialize() {
    return this.array.map((rule) => rule.value).filter((value) => value.length);
  }
}
