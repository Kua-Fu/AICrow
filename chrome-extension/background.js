chrome.action.onClicked.addListener(() => {
  const url = chrome.runtime.getURL('timestamp.html');
  chrome.tabs.create({ url });
});
