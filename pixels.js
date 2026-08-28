(() => {

  const PIXEL_CHANNEL       = 'pixels';
  const DEFAULT_PIXEL_SIZE  = 0.008;
  const DEFAULT_LIFETIME_MS = 150000;
  const MAX_LIVE_PIXELS     = 150000;
  const FLUSH_INTERVAL_MS   = 190;
  const MAX_BATCH_SIZE      = 2000;

  let pixelSeq = 0;
  let pendingPixels = [];
  let livePixels = [];
  let pixelDrawEnabled = false;
  let pubnub = null;
  let canvas = null;
  let context = null;
  let subscribed = false;

  // ------------------------------------------------------------
  // REQUEST ANIMATION FRAME HOOK
  // ------------------------------------------------------------

  const nativeRAF = window.requestAnimationFrame.bind(window);

  window.requestAnimationFrame = function(callback) {
    return nativeRAF((timestamp) => {
      callback(timestamp);
      afterFrame();
    });
  };


  // ------------------------------------------------------------
  // GET CANVAS / PUBNUB
  // ------------------------------------------------------------

  function tryAcquireRefs() {

    if (!canvas) {

      const el = document.getElementById('canvas');

      if (el) {
        canvas = el;
        context = el.getContext('2d');
      }
    }

    if (!pubnub && typeof window.PubNub === 'function') {

      pubnub = window.PubNub({});
    }

    if (pubnub && !subscribed) {

      pubnub.subscribe({
        channel: PIXEL_CHANNEL,
        messages: onPixelBatch,
      });

      subscribed = true;

      console.log(
        '[DrawOnMyFace] subscribed to',
        PIXEL_CHANNEL
      );
    }
  }


  // ------------------------------------------------------------
  // COLOR HELPERS
  // ------------------------------------------------------------

  function isTransparentColor(color) {

    if (typeof color !== 'string') {
      return false;
    }

    const normalized = color
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '');

    return (
      normalized === 'transparent' ||
      normalized === 'rgba(0,0,0,0)' ||
      normalized === 'rgba(0,0,0,0.0)' ||
      normalized === '#00000000'
    );
  }


  // ------------------------------------------------------------
  // RECEIVE PIXELS
  // ------------------------------------------------------------

  function onPixelBatch(message) {

    if (!message || !Array.isArray(message.pixels)) {
      return;
    }

    const now = Date.now();

    const size =
      typeof message.size === 'number'
        ? message.size
        : DEFAULT_PIXEL_SIZE;

    const lifetimeMs =
      typeof message.fadeMs === 'number'
        ? message.fadeMs
        : DEFAULT_LIFETIME_MS;


    message.pixels.forEach(p => {

      if (
        typeof p.x !== 'number' ||
        typeof p.y !== 'number'
      ) {
        return;
      }

      if (typeof p.color !== 'string') {
        return;
      }


      // --------------------------------------------------------
      // TRANSPARENT PIXEL
      // --------------------------------------------------------

      if (isTransparentColor(p.color)) {

        clearPixel(
          p.x,
          p.y,
          typeof p.size === 'number'
            ? p.size
            : size
        );

        return;
      }


      // --------------------------------------------------------
      // NORMAL PIXEL
      // --------------------------------------------------------

      livePixels.push({

        x: p.x,
        y: p.y,

        color: p.color,

        size:
          typeof p.size === 'number'
            ? p.size
            : size,

        userId: message.userId,

        expiresAt:
          now + lifetimeMs,
      });

    });


    // Limit memory usage.

    if (livePixels.length > MAX_LIVE_PIXELS) {

      livePixels.splice(
        0,
        livePixels.length - MAX_LIVE_PIXELS
      );
    }
  }


  // ------------------------------------------------------------
  // CLEAR ONE PIXEL
  // ------------------------------------------------------------

  function clearPixel(x, y, size) {

    if (!canvas || !context) {
      return;
    }


    const screenWidth =
      canvas.clientWidth ||
      window.innerWidth;

    const screenHeight =
      canvas.clientHeight ||
      window.innerHeight;


    const px = x * screenWidth;
    const py = y * screenHeight;

    const pixelSize = size * screenWidth;


    // Save current canvas state.

    context.save();


    // Clear only this pixel-sized rectangle.

    context.clearRect(
      px - pixelSize / 2,
      py - pixelSize / 2,
      pixelSize,
      pixelSize
    );


    context.restore();


    // --------------------------------------------------------
    // Remove matching live pixels from memory.
    // --------------------------------------------------------

    const tolerance = 0.0005;

    livePixels = livePixels.filter(p => {

      const sameX =
        Math.abs(p.x - x) <= tolerance;

      const sameY =
        Math.abs(p.y - y) <= tolerance;

      const sameSize =
        Math.abs(
          (p.size || DEFAULT_PIXEL_SIZE) -
          size
        ) <= 0.001;

      return !(
        sameX &&
        sameY &&
        sameSize
      );
    });
  }


  // ------------------------------------------------------------
  // SEND PIXEL
  // ------------------------------------------------------------

  function queuePixel(
    x,
    y,
    color,
    opts
  ) {

    pendingPixels.push({

      x: x,
      y: y,

      color: color,

      size:
        opts && typeof opts.size === 'number'
          ? opts.size
          : undefined,
    });


    if (
      pendingPixels.length >=
      MAX_BATCH_SIZE
    ) {
      flushPixels();
    }
  }


  // ------------------------------------------------------------
  // PUBLISH PIXELS
  // ------------------------------------------------------------

  function flushPixels() {

    if (pendingPixels.length === 0) {
      return;
    }

    if (!pubnub) {
      return;
    }


    pixelSeq++;


    const batch =
      pendingPixels;

    pendingPixels = [];


    pubnub.publish({

      channel: PIXEL_CHANNEL,

      message: {

        userId:
          currentUserId(),

        seq:
          pixelSeq,

        size:
          DEFAULT_PIXEL_SIZE,

        fadeMs:
          DEFAULT_LIFETIME_MS,

        pixels:
          batch,
      },
    });
  }


  // ------------------------------------------------------------
  // FLUSH TIMER
  // ------------------------------------------------------------

  setInterval(
    flushPixels,
    FLUSH_INTERVAL_MS
  );


  // ------------------------------------------------------------
  // EXPIRE NORMAL PIXELS
  // ------------------------------------------------------------

  function expirePixels() {

    if (livePixels.length === 0) {
      return;
    }


    const now =
      Date.now();


    livePixels =
      livePixels.filter(
        p => p.expiresAt > now
      );
  }


  // ------------------------------------------------------------
  // USER ID
  // ------------------------------------------------------------

  function currentUserId() {

    return (
      window.userId ||
      'pixels-' + pixelSeq
    );
  }


  // ------------------------------------------------------------
  // CURRENT DRAW STYLE
  // ------------------------------------------------------------

  function currentStyle() {

    return (
      window.activeStyle ||
      '#FF00FF'
    );
  }


  // ------------------------------------------------------------
  // DRAW LIVE PIXELS
  // ------------------------------------------------------------

  function afterFrame() {

    tryAcquireRefs();


    if (!context || !canvas) {
      return;
    }


    expirePixels();


    if (livePixels.length === 0) {
      return;
    }


    const screenWidth =
      canvas.clientWidth ||
      window.innerWidth;

    const screenHeight =
      canvas.clientHeight ||
      window.innerHeight;


    livePixels.forEach(p => {

      const px =
        p.x * screenWidth;

      const py =
        p.y * screenHeight;

      const size =
        p.size * screenWidth;


      context.fillStyle =
        p.color;


      context.fillRect(

        px - size / 2,

        py - size / 2,

        size,

        size
      );
    });
  }


  // ------------------------------------------------------------
  // PIXEL MODE
  // ------------------------------------------------------------

  function setPixelMode(enabled) {

    pixelDrawEnabled =
      !!enabled;
  }


  // ------------------------------------------------------------
  // POINTER DRAWING
  // ------------------------------------------------------------

  function handlePointerEvent(event) {

    if (!pixelDrawEnabled) {
      return;
    }


    if (
      event.type === 'pointermove' &&
      event.buttons !== 1 &&
      event.pointerType !== 'touch'
    ) {
      return;
    }


    const screenWidth =
      (canvas && canvas.clientWidth) ||
      window.innerWidth;

    const screenHeight =
      (canvas && canvas.clientHeight) ||
      window.innerHeight;


    queuePixel(

      event.clientX /
        screenWidth,

      event.clientY /
        screenHeight,

      currentStyle()
    );
  }


  // ------------------------------------------------------------
  // POINTER EVENTS
  // ------------------------------------------------------------

  window.addEventListener(
    'pointerdown',
    handlePointerEvent
  );

  window.addEventListener(
    'pointermove',
    handlePointerEvent
  );


  // ------------------------------------------------------------
  // INITIALIZE
  // ------------------------------------------------------------

  tryAcquireRefs();

  document.addEventListener(
    'DOMContentLoaded',
    tryAcquireRefs
  );


  // ------------------------------------------------------------
  // PUBLIC API
  // ------------------------------------------------------------

  window.DrawOnMyFace =
    window.DrawOnMyFace || {};


  window.DrawOnMyFace.queuePixel =
    queuePixel;


  window.DrawOnMyFace.flushPixels =
    flushPixels;


  window.DrawOnMyFace.setPixelMode =
    setPixelMode;


  window.DrawOnMyFace.getLivePixelCount =
    () => livePixels.length;


  window.DrawOnMyFace.clearPixel =
    clearPixel;


})();
