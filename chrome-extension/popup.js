document.getElementById("open-capture").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "CC_OPEN_CAPTURE" });
    window.close();
  } catch {
    const params = new URLSearchParams({ title: tab.title || "New task", url: tab.url || "" });
    await chrome.tabs.create({ url: `https://command-centre-vert-five.vercel.app/v2/capture?${params}` });
    window.close();
  }
});
