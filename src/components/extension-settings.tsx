"use client";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Field, Submit, jsonRequest, date } from "./ui";
import { useToast } from "./toasts";
import Skeleton from "./skeleton";
type Row = Record<string, any>;
export default function ExtensionSettings({ data }: { data: Row }) {
  const { notify } = useToast();
  const search = useSearchParams();
  const extensionId = search.get("extensionId") || "";
  const [devices, setDevices] = useState<Row[] | null>(null),
    [token, setToken] = useState(""),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    jsonRequest("/api/extension-devices")
      .then((r) => {
        if (active) setDevices(r);
      })
      .catch((e) => {
        if (active) {
          setDevices([]);
          notify(e.message, "error");
        }
      });
    return () => {
      active = false;
    };
  }, [revision, notify]);
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>Extensão DATAMAT</h2>
        <a className="button" href="/datamat-extension.zip" download>
          Baixar extensão
        </a>
      </div>
      <p className="muted">
        Capture referências no Mercado Livre e simule preços com os custos da
        sua loja.
      </p>
      <details className="expand">
        <summary>Como instalar</summary>
        <ol>
          <li>Baixe e extraia o arquivo.</li>
          <li>
            Abra chrome://extensions, ative o modo do desenvolvedor e escolha
            Carregar sem compactação.
          </li>
          <li>
            Selecione a pasta extraída. Abra o painel DATAMAT e clique em Parear
            pelo site.
          </li>
        </ol>
      </details>
      {/^[a-p]{32}$/.test(extensionId) ? (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            const f = new FormData(e.currentTarget);
            try {
              const result = await jsonRequest("/api/extension-devices", {
                extensionId,
                storeId: f.get("storeId"),
                name: f.get("name"),
              });
              setToken(result.token);
              setRevision((v) => v + 1);
              notify("Pareamento criado. Copie o código para a extensão.");
            } catch (e) {
              notify((e as Error).message, "error");
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="form-grid">
            <Field label="Loja da extensão">
              <select
                name="storeId"
                defaultValue={
                  search.get("store") !== "all"
                    ? search.get("store") || data.stores[0]?.id
                    : data.stores[0]?.id
                }
              >
                {data.stores.map((s: Row) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Nome do dispositivo">
              <input
                name="name"
                defaultValue="Meu Chrome"
                required
                maxLength={80}
              />
            </Field>
          </div>
          <div className="form-footer">
            <span>Acesso apenas à loja escolhida, por 30 dias.</span>
            <Submit busy={busy} label="Gerar código de pareamento" />
          </div>
        </form>
      ) : (
        <p className="small muted">
          Inicie o pareamento pelo painel da extensão para identificar este
          navegador.
        </p>
      )}
      {token && (
        <div className="extension-pairing">
          <Field
            label="Código de pareamento"
            hint="Mostrado somente agora. Cole no painel da extensão."
          >
            <input readOnly value={token} />
          </Field>
          <button
            className="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(token);
                notify("Código copiado.");
              } catch {
                notify("Selecione e copie o código.", "info");
              }
            }}
          >
            Copiar código
          </button>
          <button className="text-link" onClick={() => setToken("")}>
            Ocultar
          </button>
        </div>
      )}
      <h3>Navegadores pareados</h3>
      {!devices ? (
        <Skeleton label="Carregando dispositivos" />
      ) : (
        <div className="bounded-list">
          {devices.map((d) => (
            <div className="list-item" key={d.id}>
              <div>
                <strong>{d.name}</strong>
                <small>
                  {data.stores.find((s: Row) => s.id === d.store_id)?.name} ·{" "}
                  {d.revoked_at
                    ? "Revogado"
                    : d.expires_at < Date.now()
                      ? "Expirado"
                      : `Válido até ${date(new Date(d.expires_at).toISOString())}`}
                </small>
              </div>
              {!d.revoked_at && (
                <button
                  className="button compact"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await jsonRequest(
                        `/api/extension-devices/${d.id}/revoke`,
                        {},
                      );
                      setRevision((v) => v + 1);
                      notify("Acesso da extensão revogado.");
                    } catch (e) {
                      notify((e as Error).message, "error");
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Revogar
                </button>
              )}
            </div>
          ))}
          {!devices.length && (
            <p className="muted">Nenhum navegador pareado.</p>
          )}
        </div>
      )}
    </section>
  );
}
