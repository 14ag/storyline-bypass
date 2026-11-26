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

  let revealed = false;
  let gatesDone = false;
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
      let parent = target.parentElement;
      while (parent && parent !== document.body) {
        parent.style.setProperty('pointer-events', 'auto', 'important');
        parent = parent.parentElement;
      }
    }
  };

  const satisfySlideVariables = () => {
    const player = typeof window.GetPlayer === 'function' ? window.GetPlayer() : null;
    if (!player) return;
    const slide = window.DS?.windowManager?.getMainWindowSlide?.();
    if (!slide) return;

    const allEvents = [];
    const collectEvents = (item) => {
      if (!item) return;
      if (item.attributes?.events) allEvents.push(...item.attributes.events);
      const objs = models(item.attributes?.objects || item.objects);
      objs.forEach(collectEvents);
      const layers = models(item.attributes?.slideLayers || item.slideLayers);
      layers.forEach(collectEvents);
    };
    collectEvents(slide);

    const extractCompares = (node) => {
      if (!node || typeof node !== 'object') return;
      if (node.kind === 'compare') {
        let varStr = null;
        let targetVal = null;
        if (node.typea === 'var' && typeof node.valuea === 'string') {
          varStr = node.valuea;
          targetVal = node.valueb;
        } else if (node.typeb === 'var' && typeof node.valueb === 'string') {
          varStr = node.valueb;
          targetVal = node.valuea;
        }
        if (varStr && (node.operator === 'eq' || node.operator === 'gte' || node.operator === 'lte')) {
          const clean = varStr.replace(/^_player\./, '').replace(/^#/, '');
          if (!clean.startsWith('has') && !clean.includes('LastSlide') && !clean.includes('Session')) {
            try {
              player.SetVar(clean, targetVal);
            } catch (e) {}
          }
        }
      }
      for (const k in node) {
        if (Array.isArray(node[k])) {
          node[k].forEach(extractCompares);
        } else if (typeof node[k] === 'object') {
          extractCompares(node[k]);
        }
      }
    };
    allEvents.forEach(extractCompares);
  };

  const enableUserControls = () => {
    const slide = window.DS?.windowManager?.getMainWindowSlide?.();
    const objs = slide ? models(slide.attributes?.slideLayers).flatMap(l => models((l.attributes || l).objects)) : [];

    // Enable accessibility shadow buttons and wire click to Storyline action execution
    document.querySelectorAll('.acc-shadow-el.acc-button').forEach((control) => {
      control.style.setProperty('pointer-events', 'auto', 'important');
      control.style.setProperty('cursor', 'pointer', 'important');

      if (!control.dataset.storylineBypassWired) {
        control.dataset.storylineBypassWired = '1';
        control.addEventListener('click', () => {
          const id = control.id?.replace(/^acc-/, '') || control.dataset?.represents?.split('.').pop();
          if (!id) return;
          const targetObj = objs.find(o => (o.id || o.attributes?.id) === id);
          if (targetObj?.executePlayerEvent) {
            try {
              targetObj.executePlayerEvent('onrelease');
            } catch (e) {}
          }
        });
      }
    });

    // Storyline's layout engine hides the entire bottom nav bar and positions
    // #nav-controls off-screen (width:0, transform:translate(814px,0)) when the
    // slide is configured to hide navigation buttons. Force everything visible.
    const bottomBar = document.getElementById('bottom-bar');
    if (bottomBar) {
      bottomBar.style.setProperty('display', 'block', 'important');
    }

    const navControls = document.getElementById('nav-controls');
    if (navControls) {
      // Override the transform that pushes nav-controls off the right edge
      navControls.style.setProperty('transform', 'translate(0px, 0px)', 'important');
      navControls.style.setProperty('width', '120px', 'important');
      navControls.style.setProperty('right', '0', 'important');
      navControls.style.setProperty('position', 'absolute', 'important');
    }

    // The individual nav buttons also carry their own inline display:none
    ['next', 'prev'].forEach(id => {
      const btn = document.getElementById(id);
      if (btn) {
        btn.style.setProperty('display', 'block', 'important');
        btn.style.setProperty('pointer-events', 'auto', 'important');
      }
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
        // An object activates a gate if its onrelease actions do something that
        // changes course state (variable, animation, visited-tracking, setstates).
        // Pure hover-clear action groups (ActGrpClearHoverState) are decorative and
        // are present on EVERY button — they must not count as a gate indicator.
        const isSubstantiveActionGroup = (action) =>
          action.kind === 'exe_actiongroup' &&
          !/ClearHoverState/i.test(action.id || '') &&
          !/HoverState/i.test(action.id || '');

        const activatesGate = actions.some((action) =>
          action.kind === 'exe_animation' ||
          action.kind === 'exe_javascript' ||
          action.kind === 'adjustvar' ||
          action.kind === 'if_action' ||
          isSubstantiveActionGroup(action) ||
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
        // Check both the visible DOM target and the fallback (after revealHidden,
        // the element exists in DOM even if layout hasn't caught up yet)
        const domTarget = objectTargets(id).find(visible) || objectTargets(id)[0];
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
        target.style.setProperty('visibility', 'visible', 'important');
        target.style.setProperty('display', 'block', 'important');
        target.style.setProperty('opacity', '1', 'important');
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
      revealed = false;
      gatesDone = false;
    }

    // Auto-satisfy any variable gates on the slide so Next button unlocks
    satisfySlideVariables();

    // After timeline completes, reveal elements and activate only course gates.
    // Navigation controls remain user-controlled.
    if (timeline.playbackState() === 'ended') {
      if (!revealed) {
        revealHidden();
        revealed = true;
        // Defer gate-clicking until after the browser has flushed layout
        // from the revealHidden() DOM changes. Without this, getBoundingClientRect()
        // still returns zero-size rects and gatedObjects finds nothing visible.
        requestAnimationFrame(() => requestAnimationFrame(() => {
          clickGatedObjects();
        }));
      } else if (!gatesDone) {
        // Keep retrying on each tick until all gates are clicked.
        // clickGatedObjects returns true only if DS slide was found;
        // we consider gates done when no gated objects remain visible.
        const slide = window.DS?.windowManager?.getMainWindowSlide?.();
        if (slide && gatedObjects(slide).length === 0) {
          gatesDone = true;
        } else {
          clickGatedObjects();
        }
      }
    }
  };

  tick();
  setInterval(tick, 250);
})();
