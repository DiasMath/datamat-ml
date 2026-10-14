import { randomBytes } from "node:crypto";
const htmlEscape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function oauthPopupResponse(
  destination: URL,
  channel: string,
  provider = "mercadolivre",
) {
  const drive = provider === "google-drive",
    prefix = drive ? "drive" : "ml",
    name = drive ? "Google Drive" : "Mercado Livre";
  const nonce = randomBytes(18).toString("base64");
  const connected =
    destination.searchParams.get(prefix + "Authorization") === "connected";
  const message = connected
    ? `${name} conectado. Você pode fechar esta janela.`
    : destination.searchParams.get(prefix + "Message") ||
      "Não foi possível conectar a conta.";
  const payload = JSON.stringify({
    type: "datamat-" + prefix + "-authorization",
    channel,
    result: connected ? "connected" : "failed",
    message,
  }).replace(/</g, "\\u003c");
  return new Response(
    `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${connected ? "Conectado" : "Conexão não concluída"} · ${name}</title><style nonce="${nonce}">body{font:16px system-ui;background:#f8faf9;color:#24352d;margin:0;display:grid;place-items:center;min-height:100vh}main{max-width:460px;padding:32px}h1{font-size:24px;color:${connected ? "#18864b" : "#a94914"}}a{color:#18864b}p{line-height:1.6}</style></head><body><main><h1>${connected ? "Conectado" : "Conexão não concluída"}</h1><p>${htmlEscape(message)}</p><a href="${htmlEscape(destination.toString())}">Voltar ao sistema</a></main><script nonce="${nonce}">const data=${payload};if(window.opener)window.opener.postMessage(data,${JSON.stringify(destination.origin)});if(typeof BroadcastChannel!=='undefined'){const channel=new BroadcastChannel(${JSON.stringify("datamat-" + prefix + "-oauth-" + channel)});channel.postMessage(data);setTimeout(()=>channel.close(),200);}setTimeout(()=>window.close(),400);</script></body></html>`,
    {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
        "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'`,
      },
    },
  );
}
