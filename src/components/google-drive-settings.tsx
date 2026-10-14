"use client";
import { useEffect, useState } from "react";
import { HardDrive, LoaderCircle, ExternalLink, Copy } from "lucide-react";
import { Badge, Field, Modal, Submit, jsonRequest, string } from "./ui";
import { useToast } from "./toasts";
import { useConfirm, discardChanges, useUnsavedChanges } from "./confirmation";
import useAuthorization from "./use-ml-authorization";
type Row = Record<string, any>;
export default function GoogleDriveSettings({
  stores,
  query,
  isAdmin,
}: {
  stores: Row[];
  query: string;
  isAdmin: boolean;
}) {
  const { notify } = useToast();
  const confirm = useConfirm();
  const [rows, setRows] = useState<Row[] | null>(null),
    [editing, setEditing] = useState<Row | null>(null),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0),
    [dirty, setDirty] = useState(false),
    [error, setError] = useState("");
  useUnsavedChanges(dirty, () => {
    setDirty(false);
    setEditing(null);
  });
  useEffect(() => {
    let active = true;
    setError("");
    jsonRequest("/api/google-drive?" + query)
      .then((value) => {
        if (active) setRows(value);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [query, revision]);
  const authorization = useAuthorization({
    provider: "google-drive",
    disabled: busy,
    returnTo: "/configuracoes?" + query,
    onWorking: setBusy,
    onResult: (result) => {
      notify(
        result.message ||
          (result.connected
            ? "Google Drive conectado."
            : "Conexão não concluída."),
        result.connected ? "success" : "error",
      );
      if (result.connected) setRevision((v) => v + 1);
    },
  });
  async function close() {
    if (busy || (dirty && !(await confirm(discardChanges)))) return;
    setEditing(null);
    setDirty(false);
  }
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      notify("Endereço copiado.");
    } catch {
      notify("Selecione e copie o endereço.", "warning");
    }
  }
  async function save(form: HTMLFormElement) {
    if (!editing || busy) return;
    setBusy(true);
    try {
      const f = new FormData(form);
      await jsonRequest(
        `/api/google-drive/${editing.store_id}/application`,
        {
          clientId: string(f, "clientId"),
          clientSecret: string(f, "clientSecret"),
          folderName: string(f, "folderName"),
          version: editing.version,
        },
        "PUT",
      );
      setEditing(null);
      setDirty(false);
      setRevision((v) => v + 1);
      notify("Configuração salva. Conecte agora a conta Google.");
    } catch (e) {
      notify((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="panel-heading">
        <h2>Fotos e vídeos · Google Drive</h2>
      </div>
      <p className="small muted">
        Cada loja tem sua própria conexão. O Datamat cria uma pasta privada e
        acessa os arquivos usados por esta integração.
      </p>
      {error ? (
        <section className="panel">
          <p>{error}</p>
          <button className="button" onClick={() => setRevision((v) => v + 1)}>
            Tentar novamente
          </button>
        </section>
      ) : !rows ? (
        <div className="integration-grid">
          {stores.map((s) => (
            <section key={s.id} className="panel">
              <div
                className="drive-card-skeleton"
                role="status"
                aria-label="Carregando integração Google Drive"
              >
                <span
                  className="skeleton-bone"
                  style={{ width: "55%", height: 22 }}
                />
                <span
                  className="skeleton-bone"
                  style={{ width: "36%", height: 14 }}
                />
                <span
                  className="skeleton-bone"
                  style={{ width: "90%", height: 14 }}
                />
                <span
                  className="skeleton-bone"
                  style={{ width: "70%", height: 14 }}
                />
                <span
                  className="skeleton-bone"
                  style={{ width: "62%", height: 36 }}
                />
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="integration-grid">
          {rows.map((row) => (
            <section
              key={row.store_id}
              className={
                "panel integration-card " +
                (row.status === "connected" ? "is-connected" : "")
              }
            >
              <div className="panel-heading">
                <h2>
                  <HardDrive size={18} /> Google Drive
                </h2>
                <Badge value={row.status} />
              </div>
              <p className="small muted">
                {stores.find((s) => s.id === row.store_id)?.name}
              </p>
              <p>
                {row.email ||
                  (row.configured
                    ? "Autorize a conta Google para enviar arquivos."
                    : "Configure o cliente OAuth do Google pelo site.")}
              </p>
              {row.folderUrl && (
                <a
                  className="text-link"
                  target="_blank"
                  rel="noopener noreferrer"
                  href={row.folderUrl}
                >
                  Abrir pasta da loja <ExternalLink size={13} />
                </a>
              )}
              {isAdmin && (
                <div className="integration-actions">
                  <div className="integration-primary-actions">
                    <button
                      className="button primary"
                      disabled={busy || !row.configured}
                      onClick={() => authorization.authorize(row.store_id)}
                    >
                      {authorization.connectionId === row.store_id && (
                        <LoaderCircle size={15} className="spin" />
                      )}
                      {authorization.connectionId === row.store_id
                        ? "Aguardando autorização…"
                        : row.status === "connected"
                          ? "Renovar autorização Google"
                          : "Conectar Google Drive"}
                    </button>
                    {authorization.connectionId === row.store_id && (
                      <button className="button" onClick={authorization.cancel}>
                        Cancelar autorização
                      </button>
                    )}
                  </div>
                  <div className="integration-secondary-actions">
                    <button
                      className="text-link"
                      disabled={busy}
                      onClick={() => {
                        setEditing(row);
                        setDirty(false);
                      }}
                    >
                      Configurar Google Drive
                    </button>
                    {row.status === "connected" && (
                      <button
                        className="text-link danger-text"
                        disabled={busy}
                        onClick={async () => {
                          if (
                            !(await confirm({
                              title: "Desconectar Google Drive?",
                              description:
                                "Os arquivos continuam no Drive. O envio e a reprodução de rascunhos ficarão indisponíveis até reconectar.",
                              confirmLabel: "Desconectar",
                            }))
                          )
                            return;
                          setBusy(true);
                          try {
                            await jsonRequest(
                              `/api/google-drive/${row.store_id}/disconnect`,
                              { version: row.version },
                            );
                            setRevision((v) => v + 1);
                            notify("Google Drive desconectado.");
                          } catch (e) {
                            notify((e as Error).message, "error");
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        Desconectar Drive
                      </button>
                    )}
                  </div>
                </div>
              )}
            </section>
          ))}
        </div>
      )}
      {editing && (
        <Modal
          protectChanges={false}
          title="Configurar Google Drive"
          subtitle={stores.find((s) => s.id === editing.store_id)?.name}
          onClose={close}
        >
          <form
            className="stack drive-settings-form"
            onChange={() => setDirty(true)}
            onSubmit={(e) => {
              e.preventDefault();
              void save(e.currentTarget);
            }}
          >
            <details className="integration-permissions">
              <summary>Como configurar no Google Cloud</summary>
              <p>
                Ative a Google Drive API. Crie um cliente OAuth do tipo
                Aplicativo da Web e cadastre a URI de retorno abaixo. Na tela de
                consentimento, habilite o acesso aos arquivos usados pelo
                aplicativo (drive.file), identidade e e-mail. Se o aplicativo
                estiver em teste, adicione sua conta como usuário de teste.
              </p>
            </details>
            <Field label="Client ID Google *">
              <input
                name="clientId"
                defaultValue={editing.clientId}
                placeholder="….apps.googleusercontent.com"
                required
                maxLength={200}
                autoComplete="off"
              />
            </Field>
            <Field
              label={
                editing.configured
                  ? "Novo segredo OAuth Google"
                  : "Segredo OAuth Google *"
              }
              hint={
                editing.configured
                  ? "Deixe vazio para manter o segredo do mesmo cliente."
                  : "O segredo fica protegido no servidor e não aparece nas consultas."
              }
            >
              <input
                name="clientSecret"
                type="password"
                required={!editing.configured}
                maxLength={512}
                autoComplete="new-password"
              />
            </Field>
            <Field
              label="Nome da pasta da loja *"
              hint="Criada automaticamente na primeira autorização. Alterar este nome não renomeia uma pasta já criada."
            >
              <input
                name="folderName"
                defaultValue={
                  editing.folderName ||
                  "Datamat · " +
                    (stores.find((s) => s.id === editing.store_id)?.name ||
                      editing.store_id)
                }
                required
                maxLength={100}
              />
            </Field>
            <Field label="URI de retorno Google">
              <div className="integration-url">
                <input
                  aria-label="URI de retorno Google"
                  readOnly
                  value={editing.redirectUri}
                />
                <button
                  className="icon-button"
                  type="button"
                  aria-label="Copiar URI de retorno Google"
                  onClick={() => copy(editing.redirectUri)}
                >
                  <Copy size={16} />
                </button>
              </div>
            </Field>
            <p className="small muted">
              A autorização obtém o refresh token automaticamente. Aplicações
              Google em modo de teste podem exigir reconexão após sete dias;
              para uso contínuo, publique a tela de consentimento.
            </p>
            <div className="form-actions">
              <button
                className="button"
                type="button"
                disabled={busy}
                onClick={close}
              >
                Cancelar
              </button>
              <Submit busy={busy} label="Salvar configuração Google" />
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
