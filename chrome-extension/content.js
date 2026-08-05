(() => {
  if (window.top !== window || document.getElementById("cc-capture-button")) return;

  const button = document.createElement("button");
  button.id = "cc-capture-button";
  button.type = "button";
  button.setAttribute("aria-label", "Open Command Centre capture");
  button.textContent = "CC";

  const panel = document.createElement("aside");
  panel.id = "cc-capture-panel";
  panel.setAttribute("aria-hidden", "true");

  const close = document.createElement("button");
  close.id = "cc-capture-close";
  close.type = "button";
  close.setAttribute("aria-label", "Close Command Centre capture");
  close.textContent = "×";

  const iframe = document.createElement("iframe");
  iframe.id = "cc-capture-frame";
  iframe.title = "Command Centre capture";

  panel.append(close, iframe);
  document.documentElement.append(button, panel);

  function captureUrl() {
    const params = new URLSearchParams({ title: document.title || "New task", url: window.location.href });
    return `https://command-centre-vert-five.vercel.app/v2/capture?${params.toString()}`;
  }

  function openPanel() {
    iframe.src = captureUrl();
    panel.classList.add("cc-open");
    panel.setAttribute("aria-hidden", "false");
    button.classList.add("cc-hidden");
  }

  function closePanel() {
    panel.classList.remove("cc-open");
    panel.setAttribute("aria-hidden", "true");
    button.classList.remove("cc-hidden");
  }

  button.addEventListener("click", openPanel);
  close.addEventListener("click", closePanel);
  chrome.runtime.onMessage.addListener(message => {
    if (message?.type === "CC_OPEN_CAPTURE") openPanel();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && panel.classList.contains("cc-open")) closePanel();
  });
})();
