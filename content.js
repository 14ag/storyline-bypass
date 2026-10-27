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

  // Runs in the page's MAIN world so Storyline's window.DS is reachable.
  // The player's master clock multiplies elapsed time by playbackSpeed, and every
  // slide timeline (plus its GSAP tweens and audio clips) derives from that clock,
  // so 16x fires the reveal/onmediacomplete triggers in order instead of skipping them.
  // ponytail: 16 is Chrome's playbackRate ceiling, so a slide still takes duration/16
  // to finish; if that ever drags, seek each timeline to its duration instead.
  const SPEED = 16;

  const tune = () => {
    const app = window.DS?.appState;
    if (!app) return;
    if (app.getPlaybackSpeed() !== SPEED) app.setPlaybackSpeed(SPEED);
    if (app.getVolume() !== 0) app.setVolume(0);
  };

  tune();
  setInterval(tune, 500);
})();
