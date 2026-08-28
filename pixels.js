(() => {
  "use strict";

  /*
   * ============================================================
   * Draw On My Face
   * SIGNED CLEAR-ONLY CLIENT
   * ============================================================
   *
   * This file intentionally contains NO:
   *
   * - drawing
   * - pointer events
   * - pixel queues
   * - pixel batching
   * - pixel fading
   * - pixel storage
   * - drawing styles
   * - user pixel tracking
   *
   * It ONLY:
   *
   * 1. Connects to PubNub.
   * 2. Subscribes to "pixels".
   * 3. Looks for { type: "clear" }.
   * 4. Checks timestamp.
   * 5. Checks nonce.
   * 6. Verifies Ed25519.
   * 7. Clears the canvas if valid.
   *
   * ============================================================
   */

  // ============================================================
  // CONFIGURATION
  // ============================================================

  /*
   * Your PubNub Subscribe Key.
   *
   * For the demo, put the same subscribe key used by the
   * Draw On My Face PubNub setup here.
   */
  const PUBNUB_SUBSCRIBE_KEY =
    "demo";

  /*
   * Existing Draw On My Face channel.
   */
  const PUBNUB_CHANNEL =
    "pixels";

  /*
   * Ed25519 PUBLIC KEY.
   *
   * Your clear_client.py automatically replaces this value.
   *
   * NEVER put private.key here.
   */
  const PUBLIC_KEY_B64 =
    "zB+OixXEDO2B8Mj1bZAFrY8s6AArNBFVbUDSPRyPN7o=";


  // ============================================================
  // SECURITY SETTINGS
  // ============================================================

  /*
   * A signed command is only accepted for 30 seconds.
   */
  const MAX_COMMAND_AGE_MS =
    30 * 1000;

  /*
   * Prevent the same signed command from being processed
   * twice during this browser session.
   */
  const usedNonces =
    new Set();


  // ============================================================
  // STATE
  // ============================================================

  let pubnub = null;

  let canvas = null;

  let context = null;

  let subscribed = false;


  // ============================================================
  // LOGGING
  // ============================================================

  function log(...args) {
    console.log(
      "[DrawOnMyFace]",
      ...args
    );
  }

  function warn(...args) {
    console.warn(
      "[DrawOnMyFace]",
      ...args
    );
  }

  function error(...args) {
    console.error(
      "[DrawOnMyFace]",
      ...args
    );
  }


  // ============================================================
  // CANVAS
  // ============================================================

  function acquireCanvas() {

    if (
      canvas &&
      context
    ) {
      return true;
    }

    const element =
      document.getElementById(
        "canvas"
      );

    if (!element) {

      warn(
        "Canvas element not found."
      );

      return false;
    }

    canvas =
      element;

    context =
      element.getContext(
        "2d"
      );

    if (!context) {

      error(
        "Could not get 2D canvas context."
      );

      return false;
    }

    log(
      "Canvas acquired:",
      canvas.width,
      "x",
      canvas.height
    );

    return true;
  }


  // ============================================================
  // CLEAR CANVAS
  // ============================================================

  function clearCanvas() {

    if (
      !acquireCanvas()
    ) {

      warn(
        "Cannot clear because canvas is unavailable."
      );

      return;
    }

    context.clearRect(
      0,
      0,
      canvas.width,
      canvas.height
    );

    log(
      "Canvas cleared."
    );
  }


  // ============================================================
  // BASE64 -> UINT8ARRAY
  // ============================================================

  function base64ToBytes(
    base64
  ) {

    try {

      const binary =
        atob(base64);

      const bytes =
        new Uint8Array(
          binary.length
        );

      for (
        let i = 0;
        i < binary.length;
        i++
      ) {

        bytes[i] =
          binary.charCodeAt(i);

      }

      return bytes;

    } catch (e) {

      error(
        "Base64 decoding failed:",
        e
      );

      return null;
    }
  }


  // ============================================================
  // CREATE EXACT SIGNED PAYLOAD
  // ============================================================
  /*
   * Python signs exactly:
   *
   * clear|timestamp|nonce
   *
   * DO NOT change this format.
   */
  function createSignedPayload(
    timestamp,
    nonce
  ) {

    return (
      "clear"
      + "|"
      + timestamp
      + "|"
      + nonce
    );
  }


  // ============================================================
  // VERIFY ED25519
  // ============================================================

  async function verifySignature(
    timestamp,
    nonce,
    signatureB64
  ) {

    try {

      if (
        !window.crypto ||
        !window.crypto.subtle
      ) {

        error(
          "Web Crypto API is unavailable."
        );

        return false;
      }


      // --------------------------------------------------------
      // Public key
      // --------------------------------------------------------

      const publicKeyBytes =
        base64ToBytes(
          PUBLIC_KEY_B64
        );

      if (!publicKeyBytes) {

        error(
          "Could not decode public key."
        );

        return false;
      }


      if (
        publicKeyBytes.length !==
        32
      ) {

        error(
          "Ed25519 public key must be 32 bytes.",
          "Got:",
          publicKeyBytes.length
        );

        return false;
      }


      // --------------------------------------------------------
      // Signature
      // --------------------------------------------------------

      const signatureBytes =
        base64ToBytes(
          signatureB64
        );

      if (!signatureBytes) {

        error(
          "Could not decode signature."
        );

        return false;
      }


      if (
        signatureBytes.length !==
        64
      ) {

        error(
          "Ed25519 signature must be 64 bytes.",
          "Got:",
          signatureBytes.length
        );

        return false;
      }


      // --------------------------------------------------------
      // Payload
      // --------------------------------------------------------

      const payload =
        createSignedPayload(
          timestamp,
          nonce
        );

      log(
        "Verifying payload:",
        payload
      );

      const payloadBytes =
        new TextEncoder().encode(
          payload
        );


      // --------------------------------------------------------
      // Import public key
      // --------------------------------------------------------

      const publicKey =
        await crypto.subtle.importKey(

          "raw",

          publicKeyBytes,

          {
            name:
              "Ed25519"
          },

          false,

          [
            "verify"
          ]

        );


      // --------------------------------------------------------
      // Verify
      // --------------------------------------------------------

      const valid =
        await crypto.subtle.verify(

          {
            name:
              "Ed25519"
          },

          publicKey,

          signatureBytes,

          payloadBytes

        );


      return valid;

    } catch (e) {

      error(
        "Ed25519 verification exception:",
        e
      );

      return false;
    }
  }


  // ============================================================
  // PROCESS MESSAGE
  // ============================================================

  async function processMessage(
    message
  ) {

    log(
      "RECEIVED:",
      message
    );


    // ----------------------------------------------------------
    // Empty message
    // ----------------------------------------------------------

    if (!message) {

      warn(
        "Ignored empty PubNub message."
      );

      return;
    }


    // ----------------------------------------------------------
    // Only clear commands
    // ----------------------------------------------------------

    if (
      message.type !==
      "clear"
    ) {

      log(
        "Ignored non-clear message."
      );

      return;
    }


    log(
      "Clear command received."
    );


    // ----------------------------------------------------------
    // Timestamp
    // ----------------------------------------------------------

    if (
      typeof message.timestamp !==
      "number"
    ) {

      warn(
        "Rejected: invalid timestamp."
      );

      return;
    }


    // ----------------------------------------------------------
    // Nonce
    // ----------------------------------------------------------

    if (
      typeof message.nonce !==
      "string"
    ) {

      warn(
        "Rejected: invalid nonce."
      );

      return;
    }


    // ----------------------------------------------------------
    // Signature
    // ----------------------------------------------------------

    if (
      typeof message.signature !==
      "string"
    ) {

      warn(
        "Rejected: missing signature."
      );

      return;
    }


    // ----------------------------------------------------------
    // Timestamp validation
    // ----------------------------------------------------------

    const now =
      Date.now();

    const age =
      Math.abs(
        now -
        message.timestamp
      );

    log(
      "Command age:",
      age,
      "ms"
    );


    if (
      age >
      MAX_COMMAND_AGE_MS
    ) {

      warn(
        "Rejected: command expired."
      );

      return;
    }


    // ----------------------------------------------------------
    // Replay protection
    // ----------------------------------------------------------

    if (
      usedNonces.has(
        message.nonce
      )
    ) {

      warn(
        "Rejected: nonce already used."
      );

      return;
    }


    // ----------------------------------------------------------
    // Verify signature
    // ----------------------------------------------------------

    log(
      "Checking Ed25519 signature..."
    );

    const valid =
      await verifySignature(

        message.timestamp,

        message.nonce,

        message.signature

      );


    if (!valid) {

      warn(
        "Rejected: INVALID SIGNATURE."
      );

      return;
    }


    // ----------------------------------------------------------
    // Store nonce
    // ----------------------------------------------------------

    usedNonces.add(
      message.nonce
    );


    /*
     * Keep memory bounded.
     */
    if (
      usedNonces.size >
      1000
    ) {

      const oldest =
        usedNonces
          .values()
          .next()
          .value;

      usedNonces.delete(
        oldest
      );
    }


    // ----------------------------------------------------------
    // SUCCESS
    // ----------------------------------------------------------

    log(
      "VALID SIGNED CLEAR."
    );

    clearCanvas();
  }


  // ============================================================
  // PUBNUB INITIALIZATION
  // ============================================================

  function initializePubNub() {

    if (pubnub) {
      return true;
    }


    // ----------------------------------------------------------
    // Check PubNub SDK
    // ----------------------------------------------------------

    if (
      typeof window.PubNub !==
      "function"
    ) {

      error(
        "PubNub SDK not found."
      );

      return false;
    }


    // ----------------------------------------------------------
    // Subscribe key
    // ----------------------------------------------------------

    if (
      !PUBNUB_SUBSCRIBE_KEY ||
      PUBNUB_SUBSCRIBE_KEY ===
      "YOUR_SUBSCRIBE_KEY"
    ) {

      error(
        "PUBNUB_SUBSCRIBE_KEY is not configured."
      );

      return false;
    }


    // ----------------------------------------------------------
    // Existing repository style
    // ----------------------------------------------------------

    /*
     * The original Draw On My Face client uses:
     *
     *     window.PubNub({})
     *
     * We deliberately keep this style because the website is
     * loading an older PubNub SDK.
     */

    pubnub =
      window.PubNub({});


    log(
      "PubNub initialized."
    );


    return true;
  }


  // ============================================================
  // SUBSCRIBE
  // ============================================================

  function subscribe() {

    if (
      !initializePubNub()
    ) {

      return;
    }


    if (
      subscribed
    ) {

      return;
    }


    log(
      "Subscribing to:",
      PUBNUB_CHANNEL
    );


    /*
     * IMPORTANT:
     *
     * This is the API supported by the PubNub version
     * currently used by Draw On My Face.
     */
    pubnub.subscribe({

      channel:
        PUBNUB_CHANNEL,

      message:
        processMessage

    });


    subscribed =
      true;


    log(
      "Signed clear listener started."
    );

    log(
      "Channel:",
      PUBNUB_CHANNEL
    );
  }


  // ============================================================
  // INITIALIZATION
  // ============================================================

  function initialize() {

    acquireCanvas();

    subscribe();
  }


  initialize();


  document.addEventListener(
    "DOMContentLoaded",
    initialize
  );


  // ============================================================
  // MINIMAL PUBLIC API
  // ============================================================

  /*
   * Only local clearing is exposed.
   *
   * There is deliberately NO:
   *
   * queuePixel()
   * flushPixels()
   * setPixelMode()
   * getLivePixelCount()
   * clearUserPixels()
   * network clear()
   */

  window.DrawOnMyFace = {

    clearLocal:
      clearCanvas

  };


})();
