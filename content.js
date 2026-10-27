(() => {
  const SETTING_EVENT = 'storyline-bypass-setting';
  let enabled = localStorage.getItem('storyline-bypass-enabled') !== 'false';

  window.addEventListener(SETTING_EVENT, (event) => {
    enabled = event.detail?.enabled !== false;
  });

  const mute = (node) => {
    if (!enabled) return;
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
  // Speed 16x fast-forwards audio + timeline + animations so ontimelinetick/
  // onmediacomplete reveals fire in order, preserving navigation and xAPI tracking.
  // We play (not seek) so onrelease triggers that attach click handlers to the
  // next button fire naturally — seeking skips them and breaks navigation.
  // ponytail: 16 is Chrome's playbackRate ceiling, so narration still needs duration/16
  // to fire its completion triggers; seek the audio elements too if that ever shows.
  const SPEED = 16;

  let processed = false;
  let lastSlideId = null;

  const revealHidden = () => {
    // Force-show all hidden slide objects so interactive elements (next button,
    // etc.) are visible without requiring user interaction (clicking bulbs, etc.)
    document.querySelectorAll('.slide-object.hidden, .slide-layer.hidden').forEach(el => {
      el.classList.remove('hidden');
      el.style.setProperty('display', 'block', 'important');
      el.style.setProperty('visibility', 'visible', 'important');
      el.style.setProperty('opacity', '1', 'important');
    });
    // Enable pointer-events on stategroup parents so they're clickable
    document.querySelectorAll('.slide-object-stategroup').forEach(el => {
      el.style.setProperty('pointer-events', 'auto', 'important');
      let p = el.parentElement;
      while (p && p !== document.body) {
        p.style.setProperty('pointer-events', 'auto', 'important');
        p = p.parentElement;
      }
    });
  };

  const models = (value) => Array.isArray(value) ? value : value?.models || [];

  const visible = (element) => {
    if (!element) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' &&
      rect.width > 0 && rect.height > 0;
  };

  const objectTargets = (id) => {
    if (!id) return [];
    const targets = [
      ...document.querySelectorAll(`[data-model-id="${CSS.escape(id)}"]`),
      ...[...document.querySelectorAll('[data-represents]')]
        .filter((element) => element.dataset.represents.split('.').includes(id))
    ];
    return [...new Set(targets)];
  };

  const playerCloseEntries = () => {
    const slide = window.DS?.windowManager?.getMainWindowSlide?.();
    if (!slide) return [];
    return models(slide.attributes?.slideLayers).flatMap((layer) => {
      const attributes = layer.attributes || layer;
      return models(attributes.objects).filter((object) => {
        const release = (object.attributes?.events || [])
          .find((event) => event.kind === 'onrelease');
        return release?.actions?.some((action) => action.kind === 'hide_slidelayer');
      }).map((object) => ({
        id: object.id || object.attributes?.id,
        layerId: layer.id || attributes.id
      }));
    });
  };

  const layerHasVisibleObject = (layerId, closeId) => [...document
    .querySelectorAll('[data-represents]')]
    .some((element) => {
      const ids = element.dataset.represents.split('.');
      return ids.includes(layerId) && !ids.includes(closeId) && visible(element);
    });

  const closePlayer = () => {
    if (!enabled) return;
    try {
      const close = playerCloseTargets().find(visible);
      close?.click();
    } catch (e) {}
  };

  const playerCloseTargets = () => playerCloseEntries()
    .filter(({ id, layerId }) => layerId && layerHasVisibleObject(layerId, id))
    .flatMap(({ id }) => [
      ...[...document.querySelectorAll('button[data-represents]')]
        .filter((button) => button.dataset.represents.split('.').includes(id)),
      ...objectTargets(id)
    ]).reduce((targets, target) => {
    if (!targets.includes(target)) targets.push(target);
    const button = target.matches('button')
      ? target
      : target.querySelector('button, [data-accepts="events"]');
    if (button && !targets.includes(button)) targets.push(button);
      return targets;
    }, []);

  const enablePlayerClose = () => {
    for (const target of playerCloseTargets()) {
      target.style.setProperty('pointer-events', 'auto', 'important');
      target.style.setProperty('visibility', 'visible', 'important');
      target.style.setProperty('display', 'block', 'important');
      target.style.setProperty('opacity', '1', 'important');
      target.removeAttribute('aria-hidden');
      if (!target.dataset.storylineBypassCloseForwarder) {
        target.dataset.storylineBypassCloseForwarder = '1';
        target.addEventListener('click', () => {
          const rect = target.getBoundingClientRect();
          const graphic = document.elementsFromPoint(
            rect.left + rect.width / 2,
            rect.top + rect.height / 2
          ).find((element) => element !== target &&
            !target.contains(element) &&
            element.closest('.slide-object'));
          graphic?.dispatchEvent(new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            view: window
          }));
        });
      }
      let parent = target.parentElement;
      while (parent && parent !== document.body) {
        parent.style.setProperty('pointer-events', 'auto', 'important');
        parent = parent.parentElement;
      }
    }
  };

  const enableUserControls = () => {
    document.querySelectorAll('.acc-shadow-el.acc-button').forEach((control) => {
      control.style.setProperty('pointer-events', 'auto', 'important');
    });
  };

  const autoPlayVideo = () => {
    if (!enabled) return;
    const video = [...document.querySelectorAll('video')].find((item) =>
      !item.dataset.storylineBypassVideo && (item.readyState > 0 || item.duration > 0)
    );
    const play = [...document.querySelectorAll('button')].find((button) =>
      /^play$/i.test(button.textContent.trim()) && visible(button)
    );
    if (!video || !play) return;

    video.dataset.storylineBypassVideo = '1';
    video.playbackRate = SPEED;
    video.addEventListener('ended', closePlayer, { once: true });
    play.click();
    video.play().catch(() => {});
    if (video.ended) closePlayer();
  };

  const gatedObjects = (slide) => {
    const layers = models(slide.attributes?.slideLayers);
    return layers.flatMap((layer) => {
      const objects = models((layer.attributes || layer).objects);
      return objects.filter((object) => {
        if (!object.hasEvent?.('onrelease')) return false;

        const events = object.attributes?.events || [];
        const release = events.find((event) => event.kind === 'onrelease');
        const actions = release?.actions || [];
        const activatesGate = actions.some((action) =>
          action.kind === 'exe_animation' ||
          action.kind === 'exe_javascript' ||
          action.kind === 'adjustvar' ||
          /visited/i.test(action.id || '')
        );
        const navigates = actions.some((action) => [
          'gotoplay',
          'history_prev',
          'history_next',
          'open_url',
          'hide_slidelayer'
        ].includes(action.kind)) ||
          (actions.some((action) => action.kind === 'show_slidelayer') && !activatesGate);

        const id = object.id || object.attributes?.id;
        const domTarget = objectTargets(id).find(visible);
        return Boolean(domTarget && activatesGate && !navigates);
      });
    });
  };

  const clickGatedObjects = () => {
    const slide = window.DS?.windowManager?.getMainWindowSlide?.();
    if (!slide) return false;

    for (const object of gatedObjects(slide)) {
      const id = object.id || object.attributes?.id;
      const target = objectTargets(id).find(visible) || objectTargets(id)[0];
      if (!target) continue;
      try {
        target.style.setProperty('pointer-events', 'auto', 'important');
        let parent = target.parentElement;
        while (parent && parent !== document.body) {
          parent.style.setProperty('pointer-events', 'auto', 'important');
          parent = parent.parentElement;
        }
        const eventTarget = target.querySelector('[data-accepts="events"]') || target;
        for (const type of ['mousedown', 'mouseup', 'click']) {
          eventTarget.dispatchEvent(new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            view: window
          }));
        }
      } catch (e) {}
    }
    return true;
  };

  const tick = () => {
    if (!enabled) return;
    enableUserControls();
    enablePlayerClose();
    autoPlayVideo();
    const app = window.DS?.appState;
    if (!app) return;
    if (app.getPlaybackSpeed() !== SPEED) app.setPlaybackSpeed(SPEED);
    if (app.getVolume() !== 0) app.setVolume(0);

    const timeline = window.DS.windowManager?.getMainWindowSlide?.()?.currentTimeline?.();
    if (!timeline?.timeline) return;
    if (timeline.playbackState() === 'paused') timeline.play();

    // Reset revealed flag when slide changes
    const slideId = window.DS.windowManager?.getMainWindowSlide?.()?.id;
    if (slideId && slideId !== lastSlideId) {
      lastSlideId = slideId;
      processed = false;
    }

    // After timeline completes, reveal elements and activate only course gates.
    // Navigation controls remain user-controlled.
    if (timeline.playbackState() === 'ended' && !processed) {
      revealHidden();
      processed = true;
      clickGatedObjects();
    }
  };

  tick();
  setInterval(tick, 250);
})();
