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

  function failOpen() {
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

  function registerHeading(element) {
    if (registered.has(element) || element.closest('a,button,code,pre')) return;
    registered.add(element);
    headings.add(element);

    if (isInViewport(element)) headingReady.add(element);
    else element.classList.add('scramble-pending');
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
    if (!ready || !headingReady.has(element) || !element.isConnected) return;
    const card = element.closest(cardSelector);
    if (card && registeredCards.has(card) && !startedCards.has(card)) return;
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
            const cleanup = setTimeout(() => {
              element.classList.remove('reveal-in');
              timeouts.delete(cleanup);
            }, 650);
            timeouts.add(cleanup);
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
      const timer = setTimeout(() => {
        timeouts.delete(timer);
        beginCardReveal(card);
      }, index * 80);
      timeouts.add(timer);
    });
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
      measureCharacters(node, text).forEach(({ character, width }) => {
        if (/\s/u.test(character)) {
          const whitespace = document.createTextNode(character);
          node.parentNode.insertBefore(whitespace, node);
          inserted.push(whitespace);
          return;
        }

        const span = document.createElement('span');
        span.setAttribute('aria-hidden', 'true');
        span.style.display = 'inline-block';
        span.style.width = `${width}px`;
        span.textContent = character;
        node.parentNode.insertBefore(span, node);
        inserted.push(span);

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
      if (registeredCards.has(entry.target) && entry.intersectionRatio >= 0.15) {
        scheduleCardRow(entry.target);
      } else if (registered.has(entry.target) && entry.intersectionRatio >= 0.3) {
        headingReady.add(entry.target);
        maybeStartHeading(entry.target);
      }
    });
  }

  function initialize() {
    try {
      if (typeof IntersectionObserver !== 'function') throw new Error('IntersectionObserver is unavailable');
      style.id = 'scramble-motion-styles';
      document.head.appendChild(style);

      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

      observer = new IntersectionObserver(entries => {
        try {
          onIntersection(entries);
        } catch {
          failOpen();
        }
      }, { threshold: [0, 0.15, 0.3] });
      scan(document, true);
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

      Promise.resolve(document.fonts ? document.fonts.ready : undefined)
        .then(() => {
          if (failed) return;
          ready = true;
          headings.forEach(maybeStartHeading);
        })
        .catch(failOpen);
    } catch {
      failOpen();
    }
  }

  initialize();
})();
