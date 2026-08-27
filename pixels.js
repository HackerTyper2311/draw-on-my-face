(() => {

  const PIXEL_CHANNEL       = 'pixels';
  const DEFAULT_PIXEL_SIZE  = 0.008;
  const DEFAULT_LIFETIME_MS = 4000;
  const MAX_LIVE_PIXELS     = 4000;
  const FLUSH_INTERVAL_MS   = 80;
  const MAX_BATCH_SIZE      = 200;

  let pixelSeq = 0;
  let pendingPixels = [];
  let livePixels = [];
  let pixelDrawEnabled = false;
  let pubnub = null;
  let canvas = null;
  let context = null;
  let subscribed = false;

  // Hook requestAnimationFrame so we get a callback right after every
  // frame the host app schedules, with zero changes to index.html.
  const nativeRAF = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = function(callback) {
    return nativeRAF((timestamp) => {
      callback(timestamp);
      afterFrame();
    });
  };

  function tryAcquireRefs() {
    if (!canvas) {
      const el = document.getElementById('canvas');
      if (el) {
        canvas = el;
        context = el.getContext('2d');
      }
    }
    if (!pubnub && typeof window.PubNub === 'function') {
      // The host app already created its own `pubnub` instance internally
      // (not exposed on window), so we create our own client using the
      // same PubNub() constructor. It shares the same keys/subscribe key
      // baked into pubnub.js, so it sees the same channels/messages.
      pubnub = window.PubNub({});
    }
    if (pubnub && !subscribed) {
      pubnub.subscribe({
        channel: PIXEL_CHANNEL,
        messages: onPixelBatch,
      });
      subscribed = true;
    }
  }

  function onPixelBatch(message) {
    if (!message || !Array.isArray(message.pixels)) return;
    const now = Date.now();
    const size = typeof message.size === 'number' ? message.size : DEFAULT_PIXEL_SIZE;
    const lifetimeMs = typeof message.fadeMs === 'number' ? message.fadeMs : DEFAULT_LIFETIME_MS;

    message.pixels.forEach(p => {
      if (typeof p.x !== 'number' || typeof p.y !== 'number') return;
      if (typeof p.color !== 'string') return;
      livePixels.push({
        x: p.x,
        y: p.y,
        color: p.color,
        size: typeof p.size === 'number' ? p.size : size,
        userId: message.userId,
        expiresAt: now + lifetimeMs,
      });
    });

    if (livePixels.length > MAX_LIVE_PIXELS) {
      livePixels.splice(0, livePixels.length - MAX_LIVE_PIXELS);
    }
  }

  function queuePixel(x, y, color, opts) {
    pendingPixels.push({
      x: x,
      y: y,
      color: color,
      size: opts && opts.size,
    });
    if (pendingPixels.length >= MAX_BATCH_SIZE) flushPixels();
  }

  function flushPixels() {
    if (pendingPixels.length === 0) return;
    if (!pubnub) return;
    pixelSeq++;
    const batch = pendingPixels;
    pendingPixels = [];
    pubnub.publish({
      channel: PIXEL_CHANNEL,
      message: {
        userId: currentUserId(),
        seq: pixelSeq,
        size: DEFAULT_PIXEL_SIZE,
        fadeMs: DEFAULT_LIFETIME_MS,
        pixels: batch,
      },
    });
  }

  setInterval(flushPixels, FLUSH_INTERVAL_MS);

  function expirePixels() {
    if (livePixels.length === 0) return;
    const now = Date.now();
    livePixels = livePixels.filter(p => p.expiresAt > now);
  }

  function currentUserId() {
    return window.userId || 'pixels-' + pixelSeq;
  }

  function currentStyle() {
    return window.activeStyle || '#FF00FF';
  }

  function afterFrame() {
    tryAcquireRefs();
    if (!context || !canvas) return;

    expirePixels();
    if (livePixels.length === 0) return;

    const screenWidth = canvas.clientWidth || window.innerWidth;
    const screenHeight = canvas.clientHeight || window.innerHeight;

    livePixels.forEach(p => {
      const px = p.x * screenWidth;
      const py = p.y * screenHeight;
      const size = p.size * screenWidth;
      context.fillStyle = p.color;
      context.fillRect(px - size / 2, py - size / 2, size, size);
    });
  }

  function setPixelMode(enabled) {
    pixelDrawEnabled = !!enabled;
  }

  function handlePointerEvent(event) {
    if (!pixelDrawEnabled) return;
    if (event.type === 'pointermove' && event.buttons !== 1 && event.pointerType !== 'touch') return;
    const screenWidth = (canvas && canvas.clientWidth) || window.innerWidth;
    const screenHeight = (canvas && canvas.clientHeight) || window.innerHeight;
    queuePixel(
      event.clientX / screenWidth,
      event.clientY / screenHeight,
      currentStyle()
    );
  }

  window.addEventListener('pointerdown', handlePointerEvent);
  window.addEventListener('pointermove', handlePointerEvent);

  tryAcquireRefs();
  document.addEventListener('DOMContentLoaded', tryAcquireRefs);

  window.DrawOnMyFace = window.DrawOnMyFace || {};
  window.DrawOnMyFace.queuePixel   = queuePixel;
  window.DrawOnMyFace.flushPixels  = flushPixels;
  window.DrawOnMyFace.setPixelMode = setPixelMode;
  window.DrawOnMyFace.getLivePixelCount = () => livePixels.length;

})();

