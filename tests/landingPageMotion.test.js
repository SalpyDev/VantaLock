const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawnSync } = require('child_process');
const { chromium } = require('playwright');

const landingRoot = path.resolve(__dirname, '../landing-page');
const pagePaths = [
  '/',
  '/releases.html',
  '/terms.html',
  '/privacy.html',
  '/beta-sign.html',
  '/beta-sign/',
  '/beta-testers.html',
  '/beta-testers/',
  '/admin-beta-reports.html',
  '/admin/beta-reports.html',
  '/admin/beta-reports/'
];
const browserProbe = spawnSync(
  chromium.executablePath(),
  ['--headless', '--no-sandbox', '--disable-gpu', '--dump-dom', 'about:blank'],
  { stdio: 'ignore', timeout: 10000 }
);
const canRunBrowser = browserProbe.status === 0;
const motionDescribe = canRunBrowser ? describe : describe.skip;

motionDescribe('landing page motion', () => {
  let server;
  let baseUrl;
  let browser;

  beforeAll(async () => {
    server = http.createServer((request, response) => {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      if (pathname === '/api/beta-reports/featured') {
        response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' }).end('[]');
        return;
      }
      const requestedPath = pathname.endsWith('/') ? `${pathname}index.html` : pathname;
      const filePath = path.resolve(landingRoot, `.${requestedPath}`);
      if (!filePath.startsWith(`${landingRoot}${path.sep}`) && filePath !== path.join(landingRoot, 'index.html')) {
        response.writeHead(403).end();
        return;
      }
      fs.readFile(filePath, (error, content) => {
        if (error) {
          response.writeHead(404).end();
          return;
        }
        const extension = path.extname(filePath);
        const contentType = extension === '.html' ? 'text/html' :
          extension === '.json' ? 'application/json' :
            extension === '.js' ? 'text/javascript' :
              extension === '.svg' ? 'image/svg+xml' : 'application/octet-stream';
        response.writeHead(200, { 'content-type': `${contentType}; charset=utf-8` });
        response.end(content);
      });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true });
  });

  afterAll(async () => {
    if (browser) await browser.close();
    if (server) await new Promise(resolve => server.close(resolve));
  });

  test('removes old motion code, loads the local script on every page, and produces no console errors', async () => {
    const htmlFiles = [];
    function collectHtml(directory) {
      fs.readdirSync(directory, { withFileTypes: true }).forEach(entry => {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) collectHtml(entryPath);
        else if (entry.name.endsWith('.html')) htmlFiles.push(entryPath);
      });
    }
    collectHtml(landingRoot);

    htmlFiles.forEach(file => {
      const content = fs.readFileSync(file, 'utf8');
      expect(content).not.toMatch(/@keyframes\b|animation-(?:name|duration|delay|iteration-count|fill-mode|direction|timing-function)\s*:|data-aos|AOS|GSAP|ScrollReveal|scroll-reveal/i);
      expect(content).not.toMatch(/addEventListener\(\s*['"]scroll|requestAnimationFrame|IntersectionObserver/i);
    });
    const oldMotion = fs.readFileSync(path.join(landingRoot, 'scramble.js'), 'utf8');
    expect(oldMotion).not.toMatch(/@keyframes\b|animation-name|data-aos|GSAP|ScrollReveal|scroll-reveal|addEventListener\(\s*['"]scroll/i);

    const consoleErrors = [];
    for (const pagePath of pagePaths) {
      const page = await browser.newPage();
      page.on('pageerror', error => consoleErrors.push(`${pagePath}: ${error.message}`));
      page.on('console', message => {
        if (message.type() === 'error') consoleErrors.push(`${pagePath}: ${message.text()}`);
      });
      await page.goto(`${baseUrl}${pagePath}`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#scramble-motion-styles', { state: 'attached' });
      await page.waitForTimeout(100);
      const unexpectedHidden = await page.evaluate(() => Array.from(document.body.querySelectorAll('*'))
        .filter(element => {
          const style = getComputedStyle(element);
          if (style.display === 'none' || element.getClientRects().length === 0) return false;
          if (style.visibility === 'hidden' && !element.classList.contains('scramble-pending')) return true;
          return Number(style.opacity) === 0 && !element.classList.contains('reveal-pending');
        })
        .map(element => `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}.${element.className}`));
      expect(unexpectedHidden).toEqual([]);
      await page.close();
    }
    expect(consoleErrors).toEqual([]);
  }, 60000);

  test('holds below-fold content until entry, preserves heading geometry and text, and never replays', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#scramble-motion-styles', { state: 'attached' });
    await page.waitForTimeout(150);

    const before = await page.evaluate(() => {
      const heading = Array.from(document.querySelectorAll('.section-title'))
        .find(element => element.getBoundingClientRect().top >= window.innerHeight);
      const card = Array.from(document.querySelectorAll('.step-card'))
        .find(element => element.getBoundingClientRect().top >= window.innerHeight);
      window.__motionHeading = heading;
      window.__motionCard = card;
      return {
        headingText: heading.textContent,
        headingMarkup: heading.innerHTML,
        headingPending: heading.classList.contains('scramble-pending'),
        headingHasHelpers: Boolean(heading.querySelector('[aria-hidden="true"], .sr-only')),
        cardText: card.querySelector('.step-title').textContent,
        cardPending: card.classList.contains('reveal-pending'),
        cardOpacity: getComputedStyle(card).opacity,
        cardTransform: getComputedStyle(card).transform
      };
    });
    expect(before.headingPending).toBe(true);
    expect(before.headingHasHelpers).toBe(false);
    expect(before.cardPending).toBe(true);
    expect(before.cardOpacity).toBe('0');
    expect(before.cardTransform).toMatch(/matrix\([^,]+, [^,]+, [^,]+, [^,]+, 0, 14\)/);

    await page.evaluate(() => {
      window.__motionHeading.scrollIntoView({ behavior: 'instant', block: 'center' });
      const bounds = window.__motionHeading.getBoundingClientRect();
      window.__motionHeadingRect = { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
    });
    await page.waitForFunction(() => {
      const heading = window.__motionHeading;
      return Boolean(heading?.querySelector('.sr-only'));
    }, null, { timeout: 5000 });

    const during = await page.evaluate(() => {
      const heading = window.__motionHeading;
      const bounds = heading.getBoundingClientRect();
      return {
        rect: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
        glyphCount: heading.querySelectorAll('[aria-hidden="true"]').length,
        screenReaderText: heading.querySelector('.sr-only').textContent
      };
    });
    expect(during.glyphCount).toBeGreaterThan(0);
    expect(during.screenReaderText).toBe(before.headingText);
    expect(during.rect).toEqual(await page.evaluate(() => window.__motionHeadingRect));

    await page.waitForFunction(() => {
      const heading = window.__motionHeading;
      return !heading.querySelector('.sr-only');
    }, null, { timeout: 5000 });
    const after = await page.evaluate(() => {
      const heading = window.__motionHeading;
      const bounds = heading.getBoundingClientRect();
      return {
        text: heading.textContent,
        markup: heading.innerHTML,
        rect: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
        pending: heading.classList.contains('scramble-pending')
      };
    });
    expect(after.text).toBe(before.headingText);
    expect(after.markup).toBe(before.headingMarkup);
    expect(after.rect).toEqual(await page.evaluate(() => window.__motionHeadingRect));
    expect(after.pending).toBe(false);

    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await page.waitForTimeout(100);
    await page.evaluate(() => {
      window.__motionHeading.scrollIntoView({ behavior: 'instant', block: 'center' });
    });
    await page.waitForTimeout(1200);
    expect(await page.locator('.section-title .sr-only').count()).toBe(0);
    expect(await page.evaluate(() => window.__motionHeading.innerHTML)).toBe(before.headingMarkup);
    await page.close();
  }, 30000);

  test('reveals cards once and starts their headings only after the fade begins', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#scramble-motion-styles', { state: 'attached' });
    await page.waitForTimeout(100);

    await page.evaluate(() => {
      const card = Array.from(document.querySelectorAll('.step-card'))
        .find(element => element.getBoundingClientRect().top >= window.innerHeight);
      window.__motionCard = card;
      window.__motionCardTitle = card.querySelector('.step-title').textContent;
      card.addEventListener('transitionrun', event => {
        if (event.propertyName !== 'opacity') return;
        window.__cardFadeStart = {
          opacity: Number(getComputedStyle(card).opacity),
          headingStarted: Boolean(card.querySelector('.step-title .sr-only'))
        };
      });
      card.scrollIntoView({ behavior: 'instant', block: 'center' });
    });
    await page.waitForFunction(() => window.__cardFadeStart, null, { timeout: 5000 });
    const fadeStart = await page.evaluate(() => window.__cardFadeStart);
    expect(fadeStart.opacity).toBeLessThan(1);
    expect(fadeStart.headingStarted).toBe(false);
    await page.waitForFunction(() => {
      return Boolean(window.__motionCard.querySelector('.step-title .sr-only'));
    }, null, { timeout: 5000 });
    await page.waitForFunction(() => {
      const card = window.__motionCard;
      return !card.querySelector('.step-title .sr-only') && !card.classList.contains('reveal-pending');
    }, null, { timeout: 5000 });

    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await page.waitForTimeout(100);
    await page.evaluate(() => {
      window.__motionCard.scrollIntoView({ behavior: 'instant', block: 'center' });
    });
    await page.waitForTimeout(1200);
    const finalCard = await page.evaluate(() => ({
      pending: window.__motionCard.classList.contains('reveal-pending'),
      replaying: Boolean(window.__motionCard.querySelector('.step-title .sr-only')),
      title: window.__motionCard.querySelector('.step-title').textContent,
      titleMarkup: window.__motionCard.querySelector('.step-title').innerHTML
    }));
    expect(finalCard.pending).toBe(false);
    expect(finalCard.replaying).toBe(false);
    expect(finalCard.title).toBe(await page.evaluate(() => window.__motionCardTitle));
    expect(finalCard.titleMarkup).toBe(finalCard.title);
    await page.close();
  }, 30000);

  test('shows content immediately for reduced motion, disabled scripts, and observer failure', async () => {
    const reducedPage = await browser.newPage({ reducedMotion: 'reduce' });
    await reducedPage.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await reducedPage.waitForSelector('#scramble-motion-styles', { state: 'attached' });
    await reducedPage.waitForTimeout(100);
    expect(await reducedPage.locator('.scramble-pending, .reveal-pending, .sr-only').count()).toBe(0);
    expect(await reducedPage.locator('.faq-item').first().evaluate(element => getComputedStyle(element).opacity)).toBe('1');
    await reducedPage.close();

    const noScriptPage = await browser.newPage();
    await noScriptPage.route('**/scramble.js', route => route.abort());
    await noScriptPage.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    expect(await noScriptPage.locator('.scramble-pending, .reveal-pending, .sr-only').count()).toBe(0);
    expect(await noScriptPage.locator('.faq-item').first().evaluate(element => getComputedStyle(element).opacity)).toBe('1');
    await noScriptPage.close();

    const failedObserverPage = await browser.newPage();
    await failedObserverPage.addInitScript(() => {
      Object.defineProperty(window, 'IntersectionObserver', { configurable: true, value: undefined });
    });
    await failedObserverPage.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await failedObserverPage.waitForTimeout(100);
    expect(await failedObserverPage.locator('.scramble-pending, .reveal-pending, .reveal-in, .sr-only').count()).toBe(0);
    expect(await failedObserverPage.locator('.faq-item').first().evaluate(element => getComputedStyle(element).opacity)).toBe('1');
    await failedObserverPage.close();
  }, 30000);
});
