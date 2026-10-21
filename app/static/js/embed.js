/* VaniTTS embed helper - include on your blog page:
 *
 *   <div id="vanitts-player"></div>
 *   <script src="http://localhost:8006/static/js/embed.js"></script>
 *   <script>
 *     VaniTTS.mount("#vanitts-player", { text: longArticleText });
 *   </script>
 *
 * Options:
 *   text   - full article text (any length; sent via postMessage)
 *   voice  - optional initial voice id (e.g. "en-IN-PrabhatNeural")
 *   server - override the TTS server origin if you host embed.js yourself
 */
(function () {
  "use strict";

  var scriptOrigin = (function () {
    var s = document.currentScript;
    if (s && s.src) return new URL(s.src).origin;
    return "http://localhost:8006";   // fallback: adjust to your server
  })();

  function mount(target, opts) {
    opts = opts || {};
    var host = opts.server || scriptOrigin;
    var el = typeof target === "string" ? document.querySelector(target) : target;
    if (!el) { console.error("[VaniTTS] target element not found:", target); return; }

    var iframe = document.createElement("iframe");
    var qs = new URLSearchParams();
    if (opts.voice) qs.set("voice", opts.voice);
    iframe.src = host + "/embed?" + qs.toString();
    iframe.setAttribute("title", "VaniTTS audio player");
    iframe.setAttribute("allow", "autoplay");
    iframe.style.cssText =
      "width:100%;max-width:760px;border:0;overflow:hidden;display:block;height:120px;background:transparent;";
    el.appendChild(iframe);

    window.addEventListener("message", function (event) {
      if (event.origin !== host) return;
      var data = event.data;
      if (!data || typeof data !== "object") return;

      if (data.type === "vanitts:ready" && typeof opts.text === "string") {
        iframe.contentWindow.postMessage(
          { type: "vanitts:setText", text: opts.text, voice: opts.voice || undefined },
          host
        );
      }
      if (data.type === "vanitts:height" && typeof data.height === "number") {
        iframe.style.height = data.height + 8 + "px";   // small breathing room
      }
    });

    return iframe;
  }

  window.VaniTTS = { mount: mount };
})();
