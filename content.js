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
  // Seeking a slide timeline to its duration runs every timeline event in order and
  // renders each tween at its end state, so a slide is complete on arrival instead of
  // playing out. The speed keeps the audio clips (and their onmediacomplete triggers)
  // finishing fast in the background.
  // ponytail: 16 is Chrome's playbackRate ceiling, so narration still needs duration/16
  // to fire its completion triggers; seek the audio elements too if that ever shows.
  const SPEED = 16;

  const tick = () => {
    const app = window.DS?.appState;
    if (!app) return;
    if (app.getPlaybackSpeed() !== SPEED) app.setPlaybackSpeed(SPEED);
    if (app.getVolume() !== 0) app.setVolume(0);

    const timeline = window.DS.windowManager?.getMainWindowSlide?.()?.currentTimeline?.();
    if (timeline?.timeline && timeline.playbackState() === 'playing') {
      timeline.seek(timeline.timelineDuration());
    }
  };

  tick();
  setInterval(tick, 250);
})();
