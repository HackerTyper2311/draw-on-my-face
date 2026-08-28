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


  // ============================================================
  // REQUEST ANIMATION FRAME HOOK
  // ============================================================

  const nativeRAF =
    window.requestAnimationFrame.bind(window);

  window.requestAnimationFrame = function(callback) {

    return nativeRAF((timestamp) => {

      callback(timestamp);

      afterFrame();
    });
  };


  // ============================================================
  // GET CANVAS + PUBNUB
  // ============================================================

  function tryAcquireRefs() {

    if (!canvas) {

      const el =
        document.getElementById('canvas');

      if (el) {

        canvas = el;

        context =
          el.getContext('2d');
      }
    }


    if (
      !pubnub &&
      typeof window.PubNub === 'function'
    ) {

      pubnub =
        window.PubNub({});
    }


    if (
      pubnub &&
      !subscribed
    ) {

      pubnub.subscribe({

        channel:
          PIXEL_CHANNEL,

        messages:
          onPixelBatch,
      });

      subscribed = true;

      console.log(
        '[DrawOnMyFace] subscribed:',
        PIXEL_CHANNEL
      );
    }
  }


  // ============================================================
  // RECEIVE PUBNUB MESSAGE
  // ============================================================

  function onPixelBatch(message) {

    if (!message) {
      return;
    }


    const userId =
      typeof message.userId === 'string'
        ? message.userId
        : 'unknown';


    // ==========================================================
    // REAL CLEAR COMMAND
    // ==========================================================

    if (message.clear === true) {

      clearUserPixels(userId);

      return;
    }


    // ==========================================================
    // NORMAL PIXEL MESSAGE
    // ==========================================================

    if (!Array.isArray(message.pixels)) {
      return;
    }


    const now =
      Date.now();


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


      if (
        typeof p.color !== 'string'
      ) {
        return;
      }


      livePixels.push({

        x: p.x,

        y: p.y,

        color: p.color,

        size:
          typeof p.size === 'number'
            ? p.size
            : size,

        userId:

          typeof message.userId === 'string'
            ? message.userId
            : 'unknown',

        expiresAt:
          now + lifetimeMs,
      });
    });


    // Keep memory bounded.

    if (
      livePixels.length >
      MAX_LIVE_PIXELS
    ) {

      livePixels.splice(
        0,
        livePixels.length -
          MAX_LIVE_PIXELS
      );
    }
  }


  // ============================================================
  // CLEAR ALL PIXELS FROM ONE USER
  // ============================================================

  function clearUserPixels(userId) {

    if (!canvas || !context) {

      // Still remove them from memory.

      livePixels =
        livePixels.filter(
          p => p.userId !== userId
        );

      return;
    }


    /*
     * Because the canvas is an immediate-mode drawing surface,
     * we cannot safely remove an old rectangle from underneath
     * another user's drawing with clearRect().
     *
     * Instead:
     *
     * 1. Remove that user's pixels from livePixels.
     * 2. Rebuild the canvas from the remaining pixels.
     *
     * This preserves other users' pixels.
     */

    livePixels =
      livePixels.filter(
        p => p.userId !== userId
      );


    redrawCanvas();
  }


  // ============================================================
  // REDRAW EVERYTHING THAT IS STILL LIVE
  // ============================================================

  function redrawCanvas() {

    if (!canvas || !context) {
      return;
    }


    const width =
      canvas.width;

    const height =
      canvas.height;


    // Clear the actual drawing buffer.

    context.clearRect(
      0,
      0,
      width,
      height
    );


    const screenWidth =
      canvas.clientWidth ||
      window.innerWidth;

    const screenHeight =
      canvas.clientHeight ||
      window.innerHeight;


    /*
     * If the canvas has a different internal resolution
     * from its CSS size, scale drawing correctly.
     */

    const scaleX =
      width / screenWidth;

    const scaleY =
      height / screenHeight;


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

        (px - size / 2) * scaleX,

        (py - size / 2) * scaleY,

        size * scaleX,

        size * scaleY
      );
    });
  }


  // ============================================================
  // QUEUE LOCAL PIXEL
  // ============================================================

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
        opts &&
        typeof opts.size === 'number'
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


  // ============================================================
  // FLUSH LOCAL PIXELS
  // ============================================================

  function flushPixels() {

    if (
      pendingPixels.length === 0
    ) {
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

      channel:
        PIXEL_CHANNEL,

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


  // ============================================================
  // PERIODIC FLUSH
  // ============================================================

  setInterval(
    flushPixels,
    FLUSH_INTERVAL_MS
  );


  // ============================================================
  // EXPIRE PIXELS
  // ============================================================

  function expirePixels() {

    if (
      livePixels.length === 0
    ) {
      return;
    }


    const now =
      Date.now();


    const before =
      livePixels.length;


    livePixels =
      livePixels.filter(
        p => p.expiresAt > now
      );


    // If something expired, rebuild the canvas.

    if (
      livePixels.length !== before
    ) {

      redrawCanvas();
    }
  }


  // ============================================================
  // CURRENT USER ID
  // ============================================================

  function currentUserId() {

    return (
      window.userId ||
      'pixels-' + pixelSeq
    );
  }


  // ============================================================
  // CURRENT DRAW STYLE
  // ============================================================

  function currentStyle() {

    return (
      window.activeStyle ||
      '#FF00FF'
    );
  }


  // ============================================================
  // FRAME
  // ============================================================

  function afterFrame() {

    tryAcquireRefs();


    if (
      !context ||
      !canvas
    ) {
      return;
    }


    expirePixels();
  }


  // ============================================================
  // PIXEL DRAW MODE
  // ============================================================

  function setPixelMode(enabled) {

    pixelDrawEnabled =
      !!enabled;
  }


  // ============================================================
  // POINTER DRAWING
  // ============================================================

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
      (canvas &&
        canvas.clientWidth) ||
      window.innerWidth;


    const screenHeight =
      (canvas &&
        canvas.clientHeight) ||
      window.innerHeight;


    queuePixel(

      event.clientX /
        screenWidth,

      event.clientY /
        screenHeight,

      currentStyle()
    );
  }


  // ============================================================
  // POINTER EVENTS
  // ============================================================

  window.addEventListener(
    'pointerdown',
    handlePointerEvent
  );


  window.addEventListener(
    'pointermove',
    handlePointerEvent
  );


  // ============================================================
  // INITIALIZATION
  // ============================================================

  tryAcquireRefs();


  document.addEventListener(
    'DOMContentLoaded',
    tryAcquireRefs
  );


  // ============================================================
  // PUBLIC API
  // ============================================================

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


  window.DrawOnMyFace.clearUserPixels =
    clearUserPixels;


  // ============================================================
  // PUBLIC CLEAR COMMAND
  // ============================================================

  window.DrawOnMyFace.clear =
    function() {

      if (!pubnub) {
        return;
      }


      pubnub.publish({

        channel:
          PIXEL_CHANNEL,

        message: {

          userId:
            currentUserId(),

          clear:
            true,
        },
      });
    };


})();
