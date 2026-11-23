/**
 * High Roller Hold'em — Non-Intrusive Ad Slot Manager & Localhost Mock Ad Provider
 *
 * - On localhost / 127.0.0.1 / [::1] (or ?ads=mock): automatically renders distinct,
 *   random mock ads in #ad-slot-side and #ad-slot-bottom with zero external network calls.
 * - On public production domains when /api/ad-config returns provider === 'adsense':
 *   loads Google AdSense (adsbygoogle.js) and mounts <ins class="adsbygoogle"> only into
 *   currently visible ad slots.
 * - When ?ads=off or /api/ad-config returns enabled === false: hides all ad containers cleanly.
 */
(function () {
  'use strict';

  const MOCK_ADS = [
    {
      id: 'stackcraft-odds-lab',
      brand: 'StackCraft Odds Lab',
      category: 'Poker Analytics',
      icon: '📊',
      accent: '#38bdf8',
      bgFrom: '#0c192c',
      bgTo: '#07101d',
      headline: 'Master Multi-Way Pot Equity in 60 Seconds',
      copy: 'Interactive range visualizer, EV trainer, and side-pot odds calculator built for 5-handed tables.',
      cta: 'Try Free Sim →',
      displayUrl: 'stackcraft.example/equity',
    },
    {
      id: 'velvet-felt-supplies',
      brand: 'Monte Carlo Felt Co.',
      category: 'Table Hardware',
      icon: '♠️',
      accent: '#34d399',
      bgFrom: '#082218',
      bgTo: '#05150f',
      headline: ' Casino-Grade Clay Chips & Speed Cloth Felts',
      copy: '14-gram compression-molded clay chips, brass dealer buttons, and waterproof mahogany table rails.',
      cta: 'Shop Collection →',
      displayUrl: 'montecarlofelt.example/vip',
    },
    {
      id: 'apex-lounge-chairs',
      brand: 'Aurelius Executive Seating',
      category: 'Luxury Ergonomics',
      icon: '🪑',
      accent: '#f59e0b',
      bgFrom: '#231608',
      bgTo: '#140c04',
      headline: 'Tufted Full-Grain Leather High-Roller Chairs',
      copy: 'Engineered for 8-hour tournament sessions with solid walnut frames and brass caster wheels.',
      cta: 'Configure Yours →',
      displayUrl: 'aurelius-seating.example/salon',
    },
    {
      id: 'midnight-roast-coffee',
      brand: 'Midnight Grinder Roasters',
      category: 'Small-Batch Espresso',
      icon: '☕',
      accent: '#fb923c',
      bgFrom: '#24120b',
      bgTo: '#140905',
      headline: 'Stay Sharp Through the River Card',
      copy: 'Single-origin dark roast whole beans with notes of dark cacao, toasted hazelnut, and bourbon oak.',
      cta: 'Order Fresh Bag →',
      displayUrl: 'midnightroast.example/holdem',
    },
    {
      id: 'pocket-aces-academy',
      brand: 'Pocket Aces Academy',
      category: 'Strategy Masterclass',
      icon: '👑',
      accent: '#c084fc',
      bgFrom: '#1e102c',
      bgTo: '#11081a',
      headline: 'Stop Paying Off River Value Bets',
      copy: 'Learn board-texture reading, blocker sizings, and short-stack blind defense from high-stakes pros.',
      cta: 'Watch Lesson 1 →',
      displayUrl: 'pocketaces.example/masterclass',
    },
    {
      id: 'novacloud-edge',
      brand: 'NovaCloud Bare-Metal',
      category: 'Low-Latency Hosting',
      icon: '⚡',
      accent: '#60a5fa',
      bgFrom: '#0d1b2e',
      bgTo: '#070f1b',
      headline: 'Sub-10ms WebSocket & Node.js Game Servers',
      copy: 'Instant global deploy, DDoS protection, and deterministic container builds with zero cold starts.',
      cta: 'Claim $100 Credit →',
      displayUrl: 'novacloud.example/gaming',
    },
    {
      id: 'gilded-chronograph',
      brand: 'Vanguard Horology Genève',
      category: 'Fine Timepieces',
      icon: '⌚',
      accent: '#fbbf24',
      bgFrom: '#211a0a',
      bgTo: '#120e05',
      headline: 'The Royal Flush Automatic Chronograph',
      copy: 'Rose-gold bezel, sapphire exhibition caseback, and 72-hour Swiss mechanical power reserve.',
      cta: 'Explore Lookbook →',
      displayUrl: 'vanguard-watch.example/royal',
    },
    {
      id: 'velvet-acoustic-audio',
      brand: 'Orpheus Hi-Fi Atelier',
      category: ' Planar Headphones',
      icon: '🎧',
      accent: '#f472b6',
      bgFrom: '#240e1d',
      bgTo: '#140710',
      headline: 'Hear Every Chip Clack in Studio Clarity',
      copy: 'Open-back planar magnetic drivers with hand-stitched lambskin pads and braided OCC copper cable.',
      cta: 'Audition Today →',
      displayUrl: 'orpheus-hifi.example/studio',
    },
  ];

  const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1', '']);

  let currentMode = 'mock';
  let activeCreatives = { side: null, bottom: null };
  let toastTimer = null;

  function isLocalhostEnvironment() {
    const host = (window.location.hostname || '').trim().toLowerCase();
    return LOCAL_HOSTNAMES.has(host) || host.endsWith('.localhost');
  }

  function getQueryAdOverride() {
    try {
      const params = new URLSearchParams(window.location.search || '');
      const raw = params.get('ads');
      if (!raw) return null;
      const val = raw.trim().toLowerCase();
      if (val === 'off' || val === 'false' || val === '0' || val === 'none' || val === 'disabled') {
        return 'disabled';
      }
      if (val === 'mock' || val === '1' || val === 'true') {
        return 'mock';
      }
    } catch {
      // ignore URLSearchParams errors
    }
    return null;
  }

  function pickDistinctRandomMockAds(count, rng) {
    const randomFn = typeof rng === 'function' ? rng : Math.random;
    const pool = MOCK_ADS.slice();
    for (let i = pool.length - 1; i > 0; i -= 1) {
      const j = Math.floor(randomFn() * (i + 1));
      const tmp = pool[i];
      pool[i] = pool[j];
      pool[j] = tmp;
    }
    return pool.slice(0, Math.min(count, pool.length));
  }

  function showMockAdToast(ad, position) {
    const toast = document.getElementById('mock-ad-toast');
    if (!toast) return;
    toast.hidden = false;
    toast.textContent = `Mock Ad Preview (localhost) — "${ad.brand}" [${position} slot] (${ad.displayUrl}). Live Google AdSense serves here in production.`;
    toast.classList.add('visible');
    if (toastTimer) {
      clearTimeout(toastTimer);
    }
    toastTimer = setTimeout(() => {
      toast.classList.remove('visible');
      toast.hidden = true;
    }, 3600);
  }

  function createMockAdCardElement(ad, position) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `mock-ad-card mock-ad-${position}`;
    btn.dataset.adId = ad.id;
    btn.dataset.adBrand = ad.brand;
    btn.dataset.adPosition = position;
    btn.setAttribute('aria-label', `Sponsored Mock Ad: ${ad.brand} — ${ad.headline}`);
    btn.style.setProperty('--mock-accent', ad.accent);
    btn.style.setProperty('--mock-bg-from', ad.bgFrom);
    btn.style.setProperty('--mock-bg-to', ad.bgTo);

    const iconWrap = document.createElement('div');
    iconWrap.className = 'mock-ad-icon';
    iconWrap.setAttribute('aria-hidden', 'true');
    iconWrap.textContent = ad.icon;

    const body = document.createElement('div');
    body.className = 'mock-ad-body';

    const metaRow = document.createElement('div');
    metaRow.className = 'mock-ad-meta';

    const brandSpan = document.createElement('span');
    brandSpan.className = 'mock-ad-brand';
    brandSpan.textContent = ad.brand;

    const categorySpan = document.createElement('span');
    categorySpan.className = 'mock-ad-category';
    categorySpan.textContent = ad.category;

    metaRow.appendChild(brandSpan);
    metaRow.appendChild(categorySpan);

    const headline = document.createElement('div');
    headline.className = 'mock-ad-headline';
    headline.textContent = ad.headline;

    const copy = document.createElement('div');
    copy.className = 'mock-ad-copy';
    copy.textContent = ad.copy;

    const urlSpan = document.createElement('div');
    urlSpan.className = 'mock-ad-url';
    urlSpan.textContent = ad.displayUrl;

    body.appendChild(metaRow);
    body.appendChild(headline);
    body.appendChild(copy);
    body.appendChild(urlSpan);

    const cta = document.createElement('span');
    cta.className = 'mock-ad-cta';
    cta.textContent = ad.cta;

    btn.appendChild(iconWrap);
    btn.appendChild(body);
    btn.appendChild(cta);

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      showMockAdToast(ad, position);
    });

    return btn;
  }

  function renderMockAds(rng) {
    const sideSlot = document.getElementById('ad-slot-side');
    const bottomSlot = document.getElementById('ad-slot-bottom');
    const sideFrame = document.getElementById('ad-frame-side');
    const bottomFrame = document.getElementById('ad-frame-bottom');
    const sideBadge = document.getElementById('ad-badge-side');
    const bottomBadge = document.getElementById('ad-badge-bottom');

    const [sideAd, bottomAd] = pickDistinctRandomMockAds(2, rng);

    if (sideSlot && sideFrame && sideAd) {
      sideSlot.hidden = false;
      sideSlot.dataset.adMode = 'mock';
      sideSlot.dataset.creativeId = sideAd.id;
      if (sideBadge) sideBadge.textContent = 'AD • LOCALHOST MOCK';
      sideFrame.replaceChildren(createMockAdCardElement(sideAd, 'side'));
      activeCreatives.side = sideAd.id;
    }

    if (bottomSlot && bottomFrame && bottomAd) {
      bottomSlot.hidden = false;
      bottomSlot.dataset.adMode = 'mock';
      bottomSlot.dataset.creativeId = bottomAd.id;
      if (bottomBadge) bottomBadge.textContent = 'AD • LOCALHOST MOCK';
      bottomFrame.replaceChildren(createMockAdCardElement(bottomAd, 'bottom'));
      activeCreatives.bottom = bottomAd.id;
    }
  }

  function disableAllAdSlots() {
    currentMode = 'disabled';
    activeCreatives = { side: null, bottom: null };
    for (const id of ['ad-slot-side', 'ad-slot-bottom']) {
      const el = document.getElementById(id);
      if (el) {
        el.hidden = true;
        el.dataset.adMode = 'disabled';
        delete el.dataset.creativeId;
      }
    }
    for (const frameId of ['ad-frame-side', 'ad-frame-bottom']) {
      const frame = document.getElementById(frameId);
      if (frame) frame.replaceChildren();
    }
  }

  function isElementVisible(el) {
    if (!el || el.hidden) return false;
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }

  function mountAdSenseUnits(config) {
    if (!config || !config.clientId) {
      renderMockAds();
      return;
    }

    currentMode = 'adsense';
    activeCreatives = { side: null, bottom: null };

    // Inject AdSense script tag once if not already present
    const existingScript = document.querySelector('script[data-adsense-loader="true"]');
    if (!existingScript) {
      const script = document.createElement('script');
      script.async = true;
      script.crossOrigin = 'anonymous';
      script.dataset.adsenseLoader = 'true';
      script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(config.clientId)}`;
      document.head.appendChild(script);
    }

    const slotSpecs = [
      {
        slotEl: document.getElementById('ad-slot-side'),
        frameEl: document.getElementById('ad-frame-side'),
        badgeEl: document.getElementById('ad-badge-side'),
        slotId: config.slots && config.slots.side,
        width: '160px',
        height: '600px',
      },
      {
        slotEl: document.getElementById('ad-slot-bottom'),
        frameEl: document.getElementById('ad-frame-bottom'),
        badgeEl: document.getElementById('ad-badge-bottom'),
        slotId: config.slots && config.slots.bottom,
        width: '100%',
        height: '90px',
      },
    ];

    for (const spec of slotSpecs) {
      if (!spec.slotEl || !spec.frameEl) continue;
      if (!spec.slotId) {
        spec.slotEl.hidden = true;
        continue;
      }
      spec.slotEl.hidden = false;
      spec.slotEl.dataset.adMode = 'adsense';
      if (spec.badgeEl) spec.badgeEl.textContent = 'ADVERTISEMENT';

      // Only push an AdSense unit if the responsive slot is currently visible
      if (!isElementVisible(spec.slotEl)) continue;

      const ins = document.createElement('ins');
      ins.className = 'adsbygoogle';
      ins.style.display = 'inline-block';
      ins.style.width = spec.width;
      ins.style.height = spec.height;
      ins.setAttribute('data-ad-client', config.clientId);
      ins.setAttribute('data-ad-slot', String(spec.slotId));
      spec.frameEl.replaceChildren(ins);

      try {
        (window.adsbygoogle = window.adsbygoogle || []).push({});
      } catch {
        // Ignore AdSense push errors when blocked by client extensions
      }
    }
  }

  async function initAds() {
    const queryOverride = getQueryAdOverride();
    if (queryOverride === 'disabled') {
      disableAllAdSlots();
      return;
    }

    // Immediate render on localhost or ?ads=mock so there is zero layout shift (CLS = 0)
    if (queryOverride === 'mock' || isLocalhostEnvironment()) {
      currentMode = 'mock';
      renderMockAds();
    }

    try {
      const res = await fetch('/api/ad-config');
      if (!res.ok) return;
      const cfg = await res.json();
      if (!cfg.enabled || cfg.provider === 'disabled') {
        if (queryOverride !== 'mock') {
          disableAllAdSlots();
        }
        return;
      }
      if (cfg.provider === 'adsense' && queryOverride !== 'mock' && !isLocalhostEnvironment()) {
        mountAdSenseUnits(cfg);
        return;
      }
      if (currentMode !== 'mock' || !activeCreatives.side || !activeCreatives.bottom) {
        currentMode = 'mock';
        renderMockAds();
      }
    } catch {
      // Offline / local fallback: ensure mock ads remain rendered on localhost
      if (currentMode === 'mock' && (!activeCreatives.side || !activeCreatives.bottom)) {
        renderMockAds();
      }
    }
  }

  window.HighRollerAds = {
    MOCK_ADS,
    getMode: () => currentMode,
    getActiveCreatives: () => ({ ...activeCreatives }),
    refreshMockAds: (rng) => {
      if (currentMode === 'disabled') return;
      currentMode = 'mock';
      renderMockAds(rng);
    },
    disable: disableAllAdSlots,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAds);
  } else {
    initAds();
  }
})();
