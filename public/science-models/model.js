(function () {
  const mode = new URLSearchParams(location.search).get("mode") === "full" ? "full" : "compact";
  document.documentElement.dataset.mode = mode;
  if (document.body) document.body.classList.add(mode);

  const api = {
    topic: "",
    mode,
    applyFn: null,
    runFn: null,
    report(summary, params) {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({
          source: "science-model",
          topic: this.topic,
          summary: String(summary || ""),
          params: params || {}
        }, "*");
      }
    },
    onRun(fn) {
      this.runFn = fn;
    },
    onApply(fn) {
      this.applyFn = fn;
    }
  };

  window.addEventListener("message", (event) => {
    const data = event.data || {};
    if (data.type === "science-model-run" && api.runFn) api.runFn();
    if (data.type === "science-model-set" && api.applyFn) api.applyFn(data.params || {});
  });

  window.ScienceModel = api;
})();
