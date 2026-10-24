/* VaneeTTS embed helper - v1.9.0 */

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

    // NEW: Pass client, lang, and voice into the iframe URL
    if (opts.client) qs.set("client", opts.client);
    if (opts.lang) qs.set("lang", opts.lang);
    if (opts.voice) qs.set("voice", opts.voice); 
    
    iframe.src = host + "/embed?" + qs.toString();
    iframe.setAttribute("title", "VaniTTS audio player");
    iframe.setAttribute("allow", "autoplay");
    iframe.style.cssText =
      "width:100%;max-width:760px;border:0;overflow:hidden;display:block;height:300px;background:transparent;margin:auto;";
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
