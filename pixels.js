(() => {
  "use strict";

  /*
   * ============================================================
   * Draw On My Face
   * SIGNED CLEAR-ONLY CLIENT
   * ============================================================
   *
   * This file intentionally DOES NOT implement:
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
   * It only:
   *
   * 1. Subscribes to the pixels channel.
   * 2. Receives signed clear commands.
   * 3. Verifies the Ed25519 signature.
   * 4. Clears the canvas if the signature is valid.
   *
   * ============================================================
   */

  // ============================================================
  // CONFIGURATION
  // ============================================================

  const PUBNUB_SUBSCRIBE_KEY =
    "demo";

  const PUBNUB_CHANNEL =
    "pixels";

  /*
   * clear_client.py automatically replaces this value.
   *
   * DO NOT put the private key here.
   */
  const PUBLIC_KEY_B64 =
    "zB+OixXEDO2B8Mj1bZAFrY8s6AArNBFVbUDSPRyPN7o=";


  // ============================================================
  // SECURITY SETTINGS
  // ============================================================

  /*
   * A clear command is only valid for 30 seconds.
   *
   * This prevents an attacker from recording an old valid
   * command and replaying it much later.
   */
  const MAX_COMMAND_AGE_MS =
    30 * 1000;

  /*
   * Commands already processed during this page session.
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
      document.getElementById("canvas");

    if (!element) {
      return false;
    }

    canvas = element;

    context =
      element.getContext("2d");

    return !!context;
  }


  // ============================================================
  // CLEAR CANVAS
  // ============================================================

  function clearCanvas() {

    if (!acquireCanvas()) {

      console.warn(
        "[DrawOnMyFace] Canvas not available."
      );

      return;
    }

    context.clearRect(
      0,
      0,
      canvas.width,
      canvas.height
    );

    console.log(
      "[DrawOnMyFace] Canvas cleared."
    );
  }


  // ============================================================
  // BASE64
  // ============================================================

  function base64ToBytes(base64) {

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
  }


  // ============================================================
  // SIGNED PAYLOAD
  // ============================================================

  /*
   * Python signs EXACTLY this:
   *
   * clear|timestamp|nonce
   *
   * Therefore JavaScript must verify exactly the same bytes.
   */
  function createSignedPayload(
    timestamp,
    nonce
  ) {

    return (
      "clear|"
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

      const publicKeyBytes =
        base64ToBytes(
          PUBLIC_KEY_B64
        );

      const signatureBytes =
        base64ToBytes(
          signatureB64
        );

      const payload =
        createSignedPayload(
          timestamp,
          nonce
        );

      const payloadBytes =
        new TextEncoder().encode(
          payload
        );

      /*
       * Browser Web Crypto Ed25519.
       */
      const publicKey =
        await crypto.subtle.importKey(
          "raw",
          publicKeyBytes,
          {
            name: "Ed25519"
          },
          false,
          [
            "verify"
          ]
        );

      return await crypto.subtle.verify(
        {
          name: "Ed25519"
        },
        publicKey,
        signatureBytes,
        payloadBytes
      );

    } catch (error) {

      console.error(
        "[DrawOnMyFace] Ed25519 verification error:",
        error
      );

      return false;
    }
  }


  // ============================================================
  // CLEAR COMMAND
  // ============================================================

  async function processMessage(
    message
  ) {

    if (!message) {
      return;
    }

    /*
     * Ignore absolutely everything except:
     *
     * {
     *   type: "clear",
     *   ...
     * }
     */
    if (
      message.type !== "clear"
    ) {
      return;
    }


    // ----------------------------------------------------------
    // Validate fields
    // ----------------------------------------------------------

    if (
      typeof message.timestamp !==
        "number"
    ) {

      console.warn(
        "[DrawOnMyFace] Clear command has no valid timestamp."
      );

      return;
    }

    if (
      typeof message.nonce !==
        "string"
    ) {

      console.warn(
        "[DrawOnMyFace] Clear command has no valid nonce."
      );

      return;
    }

    if (
      typeof message.signature !==
        "string"
    ) {

      console.warn(
        "[DrawOnMyFace] Clear command has no signature."
      );

      return;
    }


    // ----------------------------------------------------------
    // Timestamp protection
    // ----------------------------------------------------------

    const now =
      Date.now();

    const age =
      Math.abs(
        now - message.timestamp
      );

    if (
      age >
      MAX_COMMAND_AGE_MS
    ) {

      console.warn(
        "[DrawOnMyFace] Rejected expired clear command."
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

      console.warn(
        "[DrawOnMyFace] Rejected replayed clear command."
      );

      return;
    }


    // ----------------------------------------------------------
    // Cryptographic verification
    // ----------------------------------------------------------

    const valid =
      await verifySignature(
        message.timestamp,
        message.nonce,
        message.signature
      );


    if (!valid) {

      console.warn(
        "[DrawOnMyFace] Rejected INVALID clear signature."
      );

      return;
    }


    // ----------------------------------------------------------
    // Remember nonce
    // ----------------------------------------------------------

    usedNonces.add(
      message.nonce
    );


    /*
     * Prevent unlimited memory usage.
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
    // VALID
    // ----------------------------------------------------------

    console.log(
      "[DrawOnMyFace] Valid signed clear command."
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

    /*
     * The repository already loads the PubNub SDK.
     */
    if (
      typeof window.PubNub !==
      "function"
    ) {

      console.error(
        "[DrawOnMyFace] PubNub SDK not found."
      );

      return false;
    }


    if (
      !PUBNUB_SUBSCRIBE_KEY ||
      PUBNUB_SUBSCRIBE_KEY ===
        "YOUR_SUBSCRIBE_KEY"
    ) {

      console.error(
        "[DrawOnMyFace] Set PUBNUB_SUBSCRIBE_KEY in pixels.js."
      );

      return false;
    }


    /*
     * PubNub JavaScript SDK.
     */
    pubnub =
      new window.PubNub({

        subscribeKey:
          PUBNUB_SUBSCRIBE_KEY,

        userId:
          "draw-on-my-face-clear-client",

        ssl:
          true
      });


    return true;
  }


  // ============================================================
  // SUBSCRIBE
  // ============================================================

  function subscribe() {

    if (!initializePubNub()) {
      return;
    }

    if (subscribed) {
      return;
    }


    /*
     * Modern PubNub subscription API.
     */
    const channel =
      pubnub.channel(
        PUBNUB_CHANNEL
      );


    const subscription =
      channel.subscription();


    subscription.on(
      "message",
      event => {

        processMessage(
          event.message
        );

      }
    );


    subscription.subscribe();


    subscribed = true;


    console.log(
      "[DrawOnMyFace] Signed clear listener started."
    );

    console.log(
      "[DrawOnMyFace] Channel:",
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
   * There is intentionally NO:
   *
   * DrawOnMyFace.queuePixel
   * DrawOnMyFace.flushPixels
   * DrawOnMyFace.setPixelMode
   * DrawOnMyFace.getLivePixelCount
   * DrawOnMyFace.clearUserPixels
   * DrawOnMyFace.clear
   *
   * The only operation here is local canvas clearing.
   */
  window.DrawOnMyFace = {

    clearLocal:
      clearCanvas

  };

})();
