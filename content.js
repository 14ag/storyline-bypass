(() => {
  const mute = (node) => {
    if (!(node instanceof HTMLMediaElement)) return;
    node.muted = true;
    node.volume = 0;
  };

  document.querySelectorAll('audio, video').forEach(mute);

  new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        mute(node);
        node.querySelectorAll?.('audio, video').forEach(mute);
      }
    }
  }).observe(document, { childList: true, subtree: true });
})();
