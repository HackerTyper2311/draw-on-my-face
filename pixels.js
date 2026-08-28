(() => {
  "use strict";

  /*
   * ============================================================
   * Draw On My Face
   * SIGNED CLEAR-ONLY CLIENT
   * ============================================================
   *
   * This replacement intentionally does NOT contain:
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
   * 1. Subscribes to the existing "pixels" PubNub channel.
   * 2. Accepts messages with type === "clear".
   * 3. Checks timestamp and nonce.
   * 4. Verifies the Ed25519 signature.
   * 5. Clears the canvas if everything is valid.
   *
   * ============================================================
   */

  // ============================================================
  // CONFIGURATION
  // ============================================================

  /*
   * For your demo, put your PubNub Subscribe Key here.
   *
   * Example:
   *
   * const PUBNUB_SUBSCRIBE_KEY =
   *   "sub-c-xxxxxxxxxxxxxxxx";
   */
  const PUBNUB_SUBSCRIBE_KEY =
    "demo";

  /*
   * Same channel used by Draw On My Face.
   */
  const PUBNUB_CHANNEL =
    "pixels";

  /*
   * This is the Ed25519 PUBLIC key.
   *
   * clear_client.py automatically writes the generated
   * public key into this value.
   *
   * NEVER put private.key here.
   */
  const PUBLIC_KEY_B64 =
    "zB+OixXEDO2B8Mj1bZAFrY8s6AArNBFVbUDSPRyPN7o=";


  // ============================================================
  // SECURITY
  // ============================================================

  /*
   * Clear commands older than 30 seconds are rejected.
   */
  const MAX_COMMAND_AGE_MS =
    30 * 1000;

  /*
   * Nonces that have already been accepted during this
   * browser session.
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
  // FIND CANVAS
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

    canvas =
      element;

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
  // BASE64 -> BYTES
  // ============================================================

  function base64ToBytes(base64) {

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

    } catch (error) {

      console.error(
        "[DrawOnMyFace] Invalid Base64:",
        error
      );

      return null;
    }
  }


  // ============================================================
  // SIGNED PAYLOAD
  // ============================================================
  /*
   * Python signs exactly:
   *
   * clear|timestamp|nonce
   *
   * JavaScript must generate the EXACT same bytes.
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

      // --------------------------------------------------------
      // Public key
      // --------------------------------------------------------

      const publicKeyBytes =
        base64ToBytes(
          PUBLIC_KEY_B64
        );

      if (!publicKeyBytes) {
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

      const payloadBytes =
        new TextEncoder().encode(
          payload
        );


      // --------------------------------------------------------
      // Import Ed25519 public key
      // --------------------------------------------------------

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


      // --------------------------------------------------------
      // Verify signature
      // --------------------------------------------------------

      const valid =
        await crypto.subtle.verify(

          {
            name: "Ed25519"
          },

          publicKey,

          signatureBytes,

          payloadBytes

        );


      return valid;

    } catch (error) {

      console.error(
        "[DrawOnMyFace] Ed25519 verification failed:",
        error
      );

      return false;
    }
  }


  // ============================================================
  // PROCESS PUBNUB MESSAGE
  // ============================================================

  async function processMessage(
    message
  ) {

    if (!message) {
      return;
    }


    // ----------------------------------------------------------
    // ONLY ACCEPT CLEAR
    // ----------------------------------------------------------

    if (
      message.type !==
      "clear"
    ) {

      /*
       * Ignore all other PubNub messages.
       *
       * This means normal pixel drawing messages from the
       * original system are NOT processed by this file.
       */

      return;
    }


    // ----------------------------------------------------------
    // VALIDATE TIMESTAMP
    // ----------------------------------------------------------

    if (
      typeof message.timestamp !==
      "number"
    ) {

      console.warn(
        "[DrawOnMyFace] Rejected clear: invalid timestamp."
      );

      return;
    }


    // ----------------------------------------------------------
    // VALIDATE NONCE
    // ----------------------------------------------------------

    if (
      typeof message.nonce !==
      "string"
    ) {

      console.warn(
        "[DrawOnMyFace] Rejected clear: invalid nonce."
      );

      return;
    }


    // ----------------------------------------------------------
    // VALIDATE SIGNATURE
    // ----------------------------------------------------------

    if (
      typeof message.signature !==
      "string"
    ) {

      console.warn(
        "[DrawOnMyFace] Rejected clear: missing signature."
      );

      return;
    }


    // ----------------------------------------------------------
    // TIMESTAMP CHECK
    // ----------------------------------------------------------

    const now =
      Date.now();

    const age =
      Math.abs(
        now -
        message.timestamp
      );


    if (
      age >
      MAX_COMMAND_AGE_MS
    ) {

      console.warn(
        "[DrawOnMyFace] Rejected clear: expired command."
      );

      return;
    }


    // ----------------------------------------------------------
    // REPLAY CHECK
    // ----------------------------------------------------------

    if (
      usedNonces.has(
        message.nonce
      )
    ) {

      console.warn(
        "[DrawOnMyFace] Rejected clear: replayed command."
      );

      return;
    }


    // ----------------------------------------------------------
    // VERIFY CRYPTOGRAPHIC SIGNATURE
    // ----------------------------------------------------------

    const valid =
      await verifySignature(

        message.timestamp,

        message.nonce,

        message.signature

      );


    if (!valid) {

      console.warn(
        "[DrawOnMyFace] Rejected clear: INVALID SIGNATURE."
      );

      return;
    }


    // ----------------------------------------------------------
    // REMEMBER NONCE
    // ----------------------------------------------------------

    usedNonces.add(
      message.nonce
    );


    /*
     * Prevent the Set from growing forever.
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
    // VALID COMMAND
    // ----------------------------------------------------------

    console.log(
      "[DrawOnMyFace] VALID SIGNED CLEAR."
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
    // Check SDK
    // ----------------------------------------------------------

    if (
      typeof window.PubNub !==
      "function"
    ) {

      console.error(
        "[DrawOnMyFace] PubNub SDK not found."
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

      console.error(
        "[DrawOnMyFace] Invalid PubNub Subscribe Key."
      );

      return false;
    }


    // ----------------------------------------------------------
    // Use the SAME PubNub initialization style as the
    // original Draw On My Face repository.
    // ----------------------------------------------------------

    /*
     * The existing repository uses the older global PubNub
     * interface, so we don't use:
     *
     *     pubnub.channel(...)
     *
     * here.
     */

    pubnub =
      window.PubNub({});


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


    /*
     * IMPORTANT:
     *
     * This uses the old PubNub API that the original
     * Draw On My Face client uses.
     */

    pubnub.subscribe({

      channel:
        PUBNUB_CHANNEL,

      message:
        processMessage

    });


    subscribed =
      true;


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
   * Only a local clear helper exists.
   *
   * There is NO network clear function here.
   *
   * A network clear can only happen through a valid
   * Ed25519-signed PubNub command.
   */

  window.DrawOnMyFace = {

    clearLocal:
      clearCanvas

  };


})();
