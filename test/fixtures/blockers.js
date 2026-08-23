(() => {
  const types = ['copy', 'cut', 'paste'];
  const hitCounts = Object.create(null);

  function record(blocker, type) {
    const key = `${blocker}:${type}`;
    hitCounts[key] = (hitCounts[key] || 0) + 1;
  }

  window.blockFromSite = (event, blocker) => {
    record(blocker, event.type);
    event.preventDefault();
    return false;
  };

  for (const type of types) {
    window.addEventListener(type, (event) => {
      if (event.target?.dataset.blocker === 'early-capture') {
        window.blockFromSite(event, 'early-capture');
      }
    }, true);
  }

  window.addEventListener('DOMContentLoaded', () => {
    const listener = document.querySelector('[data-blocker="listener"]');
    const property = document.querySelector('[data-blocker="property"]');

    for (const type of types) {
      listener.addEventListener(type, (event) => {
        window.blockFromSite(event, 'listener');
      });
      property[`on${type}`] = (event) => window.blockFromSite(event, 'property');
    }

    window.runProbe = (type, blocker) => {
      if (!types.includes(type)) {
        throw new Error(`Unknown clipboard event type: ${type}`);
      }

      const target = document.querySelector(`[data-blocker="${blocker}"]`);
      const key = `${blocker}:${type}`;
      const hitsBefore = hitCounts[key] || 0;
      const event = new Event(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
      });
      const dispatchReturned = target.dispatchEvent(event);

      return {
        defaultPrevented: event.defaultPrevented,
        dispatchReturned,
        siteHitCount: (hitCounts[key] || 0) - hitsBefore,
      };
    };

    window.fixtureReady = true;
  }, { once: true });
})();
