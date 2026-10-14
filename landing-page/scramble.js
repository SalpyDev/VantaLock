(() => {
  const headingSelector = [
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    '.section-title',
    '.vault-card-title',
    '.vault-data-types-title',
    '.step-title',
    '.step-num',
    '.faq-q',
    '.section-label',
    '.release-version',
    '.expired-title',
    '.tester-handle',
    '.crypto-label'
  ].join(',');
  const cardSelector = [
    '.vault-card',
    '.content-box',
    '.step-card',
    '.faq-item',
    '.release-card',
    '.checksum-box',
    '.known-issues-box',
    '.report-card',
    '.create-link-box',
    '.read-only-box',
    '.canonical-box'
  ].join(',');
  const glyphs = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#$%*+=?/';
  const style = document.createElement('style');
  const registered = new WeakSet();
  const registeredCards = new WeakSet();
  const startedCards = new WeakSet();
  const scheduledCards = new WeakSet();
  const headingReady = new WeakSet();
  const safetyArmed = new WeakSet();
  const played = new WeakSet();
  const cards = new Set();
  const headings = new Set();
  const activeScrambles = new Set();
  const timeouts = new Set();
  let observer;
  let mutationObserver;
  let ready = false;
  let failed = false;
  let animationFrame = 0;

  style.textContent = `
    .scramble-pending { visibility: hidden; }
    .scramble-glyph { opacity: 0.55; }
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }
    .reveal-pending {
      opacity: 0;
      transform: translateY(14px);
      pointer-events: none;
    }
    .reveal-in {
      opacity: 1;
      transform: translateY(0);
      transition: opacity 600ms ease-out, transform 600ms ease-out;
    }
  `;

  function later(fn, ms) {
    const timer = setTimeout(() => {
      timeouts.delete(timer);
      try {
        fn();
      } catch {
        failOpen();
      }
    }, ms);
    timeouts.add(timer);
    return timer;
  }

  // Hide headings and cards the instant this script runs, so real text is never
  // readable before its scramble / fade-in. If this script is loaded in <head>
  // without defer, that happens before the first paint. releaseBoot() lifts the
  // hiding once the script has applied its own pending classes, and a 3-second
  // watchdog guarantees nothing can stay hidden.
  function bootHide() {
    try {
      if (typeof IntersectionObserver !== 'function') return;
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const root = document.documentElement;
      if (!document.getElementById('scramble-boot-styles')) {
        const bootStyle = document.createElement('style');
        bootStyle.id = 'scramble-boot-styles';
        bootStyle.textContent =
          `html.scramble-boot :is(${headingSelector}){visibility:hidden}` +
          `html.scramble-boot :is(${cardSelector}){opacity:0}`;
        (document.head || root).appendChild(bootStyle);
      }
      root.classList.add('scramble-boot');
      setTimeout(releaseBoot, 3000);
    } catch {
      /* the page simply shows normally */
    }
  }

  function releaseBoot() {
    document.documentElement.classList.remove('scramble-boot');
    const bootStyle = document.getElementById('scramble-boot-styles');
    if (bootStyle) bootStyle.remove();
  }

  function failOpen() {
    releaseBoot();
    failed = true;
    if (observer) observer.disconnect();
    if (mutationObserver) mutationObserver.disconnect();
    if (animationFrame) cancelAnimationFrame(animationFrame);
    animationFrame = 0;
    timeouts.forEach(clearTimeout);
    activeScrambles.forEach(restoreScramble);
    document.querySelectorAll('.scramble-pending, .reveal-pending, .reveal-in')
      .forEach(element => element.classList.remove('scramble-pending', 'reveal-pending', 'reveal-in'));
  }

  function isInViewport(element) {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 &&
      rect.bottom > 0 && rect.top < window.innerHeight &&
      rect.right > 0 && rect.left < window.innerWidth;
  }

  // FIX 2: gradient text (background-clip: text) vanishes if its letters are
  // wrapped in spans, so such headings are left alone and always show normally.
  function hasClippedText(element) {
    return [element, ...element.querySelectorAll('*')].some(node => {
      const computed = getComputedStyle(node);
      return computed.backgroundClip === 'text' || computed.webkitBackgroundClip === 'text';
    });
  }

  function registerHeading(element) {
    if (registered.has(element) || element.closest('a,button,code,pre,li,.badge,.channel-badge,.pill-tag,.vault-card-badge')) return;
    registered.add(element);
    if (hasClippedText(element)) return;
    headings.add(element);

    // FIX 4: headings already in view are hidden too, until the scramble
    // starts, so they never flash real text and then flip to scrambled.
    element.classList.add('scramble-pending');
    if (isInViewport(element)) {
      headingReady.add(element);
      later(() => {
        if (!played.has(element)) {
          played.add(element);
          element.classList.remove('scramble-pending');
          if (observer) observer.unobserve(element);
        }
      }, 1000);
    }
    observer.observe(element);
  }

  function registerCard(element, initialScan) {
    if (registeredCards.has(element) || element.closest('nav,footer,.hero,#hero,.hero-section')) return;
    registeredCards.add(element);
    cards.add(element);

    if (initialScan && isInViewport(element)) {
      startedCards.add(element);
      return;
    }

    element.classList.add('reveal-pending');
    observer.observe(element);
  }

  function scan(root, initialScan = false) {
    if (root.nodeType !== Node.ELEMENT_NODE && root !== document) return;
    const scope = root === document ? document : root;
    if (root !== document && root.matches(cardSelector)) registerCard(root, initialScan);
    scope.querySelectorAll(cardSelector).forEach(element => registerCard(element, initialScan));
    if (root !== document && root.matches(headingSelector)) registerHeading(root);
    scope.querySelectorAll(headingSelector).forEach(registerHeading);
  }

  function maybeStartHeading(element) {
    if (!ready || !headingReady.has(element) || !element.isConnected || played.has(element)) return;
    const card = element.closest(cardSelector);
    if (card && registeredCards.has(card) && !startedCards.has(card)) return;
    played.add(element);
    observer.unobserve(element);
    element.classList.remove('scramble-pending');
    beginScramble(element);
  }

  function rowCards(element) {
    let grid = element.parentElement;
    while (grid && grid !== document.body) {
      const display = getComputedStyle(grid).display;
      if (display === 'grid' || display === 'inline-grid' || display === 'flex' || display === 'inline-flex') break;
      grid = grid.parentElement;
    }
    if (!grid || grid === document.body) return [element];

    const top = element.getBoundingClientRect().top;
    const tolerance = Math.max(10, Math.min(24, element.getBoundingClientRect().height * 0.1));
    const row = Array.from(cards).filter(card =>
      card.isConnected &&
      card !== element &&
      grid.contains(card) &&
      card.classList.contains('reveal-pending') &&
      isInViewport(card) &&
      Math.abs(card.getBoundingClientRect().top - top) <= tolerance
    );
    row.push(element);
    return row.sort((left, right) => left.getBoundingClientRect().left - right.getBoundingClientRect().left);
  }

  function beginCardReveal(element) {
    if (failed) return;
    element.classList.add('reveal-in');
    requestAnimationFrame(() => {
      try {
        if (failed) return;
        element.classList.remove('reveal-pending');
        startedCards.add(element);
        requestAnimationFrame(() => {
          try {
            if (failed) return;
            element.querySelectorAll(headingSelector).forEach(maybeStartHeading);
            later(() => element.classList.remove('reveal-in'), 650);
          } catch {
            failOpen();
          }
        });
      } catch {
        failOpen();
      }
    });
  }

  function scheduleCardRow(element) {
    if (scheduledCards.has(element)) return;
    rowCards(element).forEach((card, index) => {
      if (scheduledCards.has(card)) return;
      scheduledCards.add(card);
      observer.unobserve(card);
      later(() => beginCardReveal(card), index * 80);
    });
  }

  // FIX 1: safety net. Anything that has been on screen for 2 seconds and is
  // still pending (for example a card taller than the viewport that never
  // reaches 15% visible) is revealed anyway.
  function armSafety(element) {
    if (safetyArmed.has(element)) return;
    safetyArmed.add(element);
    later(() => {
      if (failed || !element.isConnected) return;
      if (!isInViewport(element)) {
        safetyArmed.delete(element);
        return;
      }
      if (registeredCards.has(element)) {
        scheduleCardRow(element);
      } else if (registered.has(element)) {
        const card = element.closest(cardSelector);
        if (card && registeredCards.has(card) && !startedCards.has(card)) scheduleCardRow(card);
        headingReady.add(element);
        maybeStartHeading(element);
      }
    }, 2000);
  }

  function measureCharacters(textNode, text) {
    const range = document.createRange();
    const result = [];
    let offset = 0;
    Array.from(text).forEach(character => {
      const start = offset;
      offset += character.length;
      let width = 0;
      if (!/\s/u.test(character)) {
        range.setStart(textNode, start);
        range.setEnd(textNode, offset);
        width = range.getBoundingClientRect().width;
      }
      result.push({ character, width });
    });
    range.detach();
    return result;
  }

  function restoreScramble(state) {
    state.records.forEach(record => {
      record.inserted.forEach(node => node.remove());
      record.node.nodeValue = record.text;
    });
    state.screenReaderCopy.remove();
    state.element.classList.remove('scramble-pending');
    activeScrambles.delete(state);
  }

  function beginScramble(element) {
    if (Array.from(activeScrambles).some(state => state.element === element)) return;
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        return node.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);
    if (!textNodes.length) return;

    const records = [];
    const characters = [];
    const screenReaderCopy = document.createElement('span');
    screenReaderCopy.className = 'sr-only';
    screenReaderCopy.textContent = element.textContent;
    const state = {
      element,
      records,
      characters,
      screenReaderCopy,
      startedAt: performance.now()
    };
    activeScrambles.add(state);

    textNodes.forEach(node => {
      const text = node.nodeValue;
      const inserted = [];
      const record = { node, text, inserted };
      records.push(record);
      // FIX 3: letters of one word live inside a single no-wrap wrapper, so a
      // line can only break between words, exactly as in the original text.
      let wordWrapper = null;
      measureCharacters(node, text).forEach(({ character, width }) => {
        if (/\s/u.test(character)) {
          wordWrapper = null;
          const whitespace = document.createTextNode(character);
          node.parentNode.insertBefore(whitespace, node);
          inserted.push(whitespace);
          return;
        }

        if (!wordWrapper) {
          wordWrapper = document.createElement('span');
          wordWrapper.style.whiteSpace = 'nowrap';
          node.parentNode.insertBefore(wordWrapper, node);
          inserted.push(wordWrapper);
        }

        const span = document.createElement('span');
        span.setAttribute('aria-hidden', 'true');
        span.style.display = 'inline-block';
        span.style.width = `${width}px`;
        span.textContent = character;
        wordWrapper.appendChild(span);

        if (/^[\p{L}\p{N}]$/u.test(character)) {
          const index = characters.length;
          const start = Math.min(index * 26 + Math.random() * 18, 500);
          characters.push({
            span,
            character,
            start,
            duration: Math.min(300 + Math.random() * 400, 1200 - start),
            lastRefresh: 0
          });
        }
      });
      node.nodeValue = '';
    });

    element.appendChild(screenReaderCopy);
    startAnimationLoop();
  }

  function tick(now) {
    animationFrame = 0;
    const finished = [];
    activeScrambles.forEach(state => {
      let complete = true;
      state.characters.forEach(character => {
        const elapsed = now - state.startedAt - character.start;
        if (elapsed < 0) {
          complete = false;
          return;
        }
        if (elapsed >= character.duration) {
          character.span.textContent = character.character;
          character.span.classList.remove('scramble-glyph');
          return;
        }
        complete = false;
        if (now - character.lastRefresh >= 40) {
          character.span.textContent = glyphs[Math.floor(Math.random() * glyphs.length)];
          character.span.classList.add('scramble-glyph');
          character.lastRefresh = now;
        }
      });
      if (complete) finished.push(state);
    });
    finished.forEach(restoreScramble);
    startAnimationLoop();
  }

  function startAnimationLoop() {
    if (!animationFrame && activeScrambles.size) {
      animationFrame = requestAnimationFrame(now => {
        try {
          tick(now);
        } catch {
          failOpen();
        }
      });
    }
  }

  function onIntersection(entries) {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const target = entry.target;
      if (registeredCards.has(target)) {
        const tallEnough = entry.intersectionRect.height >= window.innerHeight * 0.15;
        if (entry.intersectionRatio >= 0.15 || tallEnough) scheduleCardRow(target);
        else armSafety(target);
      } else if (registered.has(target)) {
        if (entry.intersectionRatio >= 0.3) {
          headingReady.add(target);
          maybeStartHeading(target);
        } else {
          armSafety(target);
        }
      }
    });
  }

  function markReady() {
    if (failed || ready) return;
    ready = true;
    headings.forEach(maybeStartHeading);
  }

  function initialize() {
    try {
      if (typeof IntersectionObserver !== 'function') throw new Error('IntersectionObserver is unavailable');
      style.id = 'scramble-motion-styles';
      document.head.appendChild(style);

      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        releaseBoot();
        return;
      }

      observer = new IntersectionObserver(entries => {
        try {
          onIntersection(entries);
        } catch {
          failOpen();
        }
      }, { threshold: [0, 0.02, 0.05, 0.1, 0.15, 0.3] });
      scan(document, true);
      releaseBoot();
      mutationObserver = new MutationObserver(records => {
        try {
          records.forEach(record => record.addedNodes.forEach(node => {
            if (node.nodeType === Node.ELEMENT_NODE) scan(node);
          }));
        } catch {
          failOpen();
        }
      });
      mutationObserver.observe(document.body, { childList: true, subtree: true });

      // Fonts normally load fast; never wait on them for more than 1.5s.
      later(markReady, 1500);
      Promise.resolve(document.fonts ? document.fonts.ready : undefined)
        .then(markReady)
        .catch(failOpen);
    } catch {
      failOpen();
    }
  }

  bootHide();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, { once: true });
  } else {
    initialize();
  }
})();