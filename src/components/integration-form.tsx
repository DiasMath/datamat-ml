"use client";
import { useState } from "react";
import { Copy, Eye, EyeOff } from "lucide-react";
import { Field, Submit, string } from "./ui";
import { useToast } from "./toasts";
type Row = Record<string, any>;
export default function IntegrationForm({
  connection,
  busy,
  onDirty,
  onSave,
}: {
  connection: Row;
  busy: boolean;
  onDirty: () => void;
  onSave: (data: Row) => Promise<boolean>;
}) {
  const [visible, setVisible] = useState(false);
  const { notify } = useToast();
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      notify("Endereço copiado.");
    } catch {
      notify("Não foi possível copiar. Selecione e copie o endereço.", "error");
    }
  }
  return (
    <form
      className="stack"
      onChange={onDirty}
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const values = new FormData(form);
        if (
          await onSave({
            clientId: string(values, "clientId"),
            clientSecret: string(values, "clientSecret"),
            version: connection.application_version,
          })
        )
          form.reset();
      }}
    >
      <p className="muted small">
        As credenciais são usadas somente nesta loja. Depois de salvar, autorize
        a conta correspondente no Mercado Livre.
      </p>
      <div className="form-grid">
        <Field label="ID do aplicativo *">
          <input
            name="clientId"
            defaultValue={connection.application_id || ""}
            required
            inputMode="numeric"
            pattern="[1-9][0-9]{0,31}"
            maxLength={32}
            autoComplete="off"
          />
        </Field>
        <Field
          label={
            connection.application_source === "store"
              ? "Nova chave secreta"
              : "Chave secreta *"
          }
          hint={
            connection.application_source === "store"
              ? "Deixe vazio para manter a chave salva do mesmo aplicativo."
              : "Informe a chave fornecida pelo portal de desenvolvedores."
          }
        >
          <div className="secret-input">
            <input
              name="clientSecret"
              aria-label={
                connection.application_source === "store"
                  ? "Nova chave secreta"
                  : "Chave secreta *"
              }
              type={visible ? "text" : "password"}
              required={connection.application_source !== "store"}
              maxLength={512}
              autoComplete="new-password"
              spellCheck={false}
            />
            <button
              type="button"
              className="icon-button"
              aria-label={
                visible ? "Ocultar chave secreta" : "Mostrar chave secreta"
              }
              onClick={() => setVisible((v) => !v)}
            >
              {visible ? <EyeOff size={17} /> : <Eye size={17} />}
            </button>
          </div>
        </Field>
      </div>
      <div className="integration-addresses">
        {[
          ["URI de redirect", connection.redirect_uri],
          ["URL de notificações", connection.notification_uri],
        ].map(([label, value]) => (
          <div key={label}>
            <Field label={label}>
              <input value={value || ""} readOnly autoComplete="off" />
            </Field>
            <button
              type="button"
              className="icon-button"
              disabled={!value}
              aria-label={`Copiar ${label}`}
              onClick={() => copy(value)}
            >
              <Copy size={16} />
            </button>
          </div>
        ))}
        <p className="muted small">
          Cadastre estes dois endereços na aplicação do Mercado Livre.
        </p>
      </div>
      {connection.external_account && (
        <p className="small muted">
          Alterar o aplicativo ou a chave encerra a autorização atual e exige
          conectar novamente. Seus anúncios, custos e histórico são preservados.
        </p>
      )}
      {!connection.secret_storage_ready && (
        <p className="small danger-text">
          O armazenamento protegido das integrações precisa ser habilitado na
          instalação do sistema.
        </p>
      )}
      <div className="form-footer">
        <span>Chave protegida no servidor; nunca devolvida à tela.</span>
        <Submit
          busy={busy || !connection.secret_storage_ready}
          label="Salvar integração"
        />
      </div>
    </form>
  );
}
