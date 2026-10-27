const KEY = 'storyline-bypass-enabled';

const activeTab = async () => {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
};

const readEnabled = async (tabId) => {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: (key) => localStorage.getItem(key) !== 'false',
      args: [KEY]
    });
    return result.result;
  } catch {
    return true;
  }
};

const writeEnabled = async (tabId, enabled) => {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: ({ key, value }) => {
      localStorage.setItem(key, String(value));
      window.dispatchEvent(new CustomEvent('storyline-bypass-setting', {
        detail: { enabled: value }
      }));
    },
    args: [{ key: KEY, value: enabled }]
  });
};

document.addEventListener('DOMContentLoaded', async () => {
  const checkbox = document.getElementById('enabled');
  const tab = await activeTab();
  if (!tab?.id) return;

  checkbox.checked = await readEnabled(tab.id);
  checkbox.addEventListener('change', async () => {
    checkbox.disabled = true;
    try {
      await writeEnabled(tab.id, checkbox.checked);
    } finally {
      checkbox.disabled = false;
    }
  });
});
