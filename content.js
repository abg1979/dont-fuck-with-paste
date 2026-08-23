let runtime;

try {
  runtime = browser.runtime;
} catch {
  runtime = chrome.runtime;
}

const forceBrowserDefault = function(e){
  if (active) {
    e.stopImmediatePropagation();
  }

  return true;
};

let active = false;

window.addEventListener('copy', forceBrowserDefault, true);
window.addEventListener('cut', forceBrowserDefault, true);
window.addEventListener('paste', forceBrowserDefault, true);

runtime.onMessage.addListener((message) => {
  active = Boolean(message.active);
});

runtime.sendMessage({ didLoad: true })
  .then((initialState) => {
    if (typeof initialState === 'boolean') {
      active = initialState;
    }
  })
  .catch((error) => {
    console.error('Failed to request activation state', error);
  });
