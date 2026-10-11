import { capturePage } from "./capture";
declare const chrome: any;
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(() => {});
chrome.storage.local
  .setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" })
  .catch(() => {});
chrome.runtime.onMessage.addListener(
  (message: any, _sender: any, reply: (result: any) => void) => {
    if (message.type !== "capture") return;
    (async () => {
      const [tab] = await chrome.tabs.query({
        active: true,
        lastFocusedWindow: true,
      });
      if (
        !tab?.id ||
        !/^https:\/\/(?:[a-z0-9-]+\.)*mercadolivre\.com\.br\//i.test(
          tab.url || "",
        )
      )
        throw new Error("Abra um anúncio ou uma pesquisa do Mercado Livre.");
      const [result] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: capturePage,
      });
      reply({ rows: result?.result || [] });
    })().catch((e) => reply({ error: e.message }));
    return true;
  },
);
