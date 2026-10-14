"use client";
import { useEffect, useState, useRef } from "react";
import {
  ImageOff,
  Image as ImageIcon,
  Play,
  Upload,
  LoaderCircle,
  Trash2,
  ExternalLink,
} from "lucide-react";
import { Modal, trackedFetch, jsonRequest, date } from "./ui";
import { useToast } from "./toasts";
type Row = Record<string, any>;
export function MediaImage({
  src,
  alt,
  className = "",
  eager = false,
}: {
  src?: string | null;
  alt: string;
  className?: string;
  eager?: boolean;
}) {
  const [state, setState] = useState("loading");
  const image = useRef<HTMLImageElement>(null);
  useEffect(
    () =>
      setState(
        !src
          ? "error"
          : image.current?.complete
            ? image.current.naturalWidth
              ? "ready"
              : "error"
            : "loading",
      ),
    [src],
  );
  return (
    <span className={`media-image ${className} ${state}`}>
      {src && state !== "error" ? (
        <>
          <img
            ref={image}
            src={src}
            alt={alt}
            loading={eager ? "eager" : "lazy"}
            onLoad={() => setState("ready")}
            onError={() => setState("error")}
          />
          {state === "loading" && (
            <span
              className="media-image-skeleton"
              aria-label="Carregando foto"
            />
          )}
        </>
      ) : (
        <span className="media-image-empty" title="Foto indisponível">
          <ImageOff size={20} />
          <span className="sr-only">{alt}: foto indisponível</span>
        </span>
      )}
    </span>
  );
}
function MediaVideo({ src, name }: { src: string; name: string }) {
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(false);
  return (
    <div className="media-video">
      {loading && (
        <span className="media-video-loading" role="status">
          <LoaderCircle className="spin" />
          Carregando vídeo…
        </span>
      )}
      {error && <p>Não foi possível carregar este vídeo.</p>}
      <video
        src={src}
        controls
        preload="metadata"
        aria-label={name}
        onLoadedMetadata={() => setLoading(false)}
        onWaiting={() => setLoading(true)}
        onPlaying={() => setLoading(false)}
        onError={() => {
          setLoading(false);
          setError(true);
        }}
      />
    </div>
  );
}
export default function ListingMedia({
  detail,
  canWrite,
  busy,
  onWorking,
  onChanged,
  onRefresh,
}: {
  detail: Row;
  canWrite: boolean;
  busy: boolean;
  onWorking: (value: boolean) => void;
  onChanged: () => void;
  onRefresh: () => void;
}) {
  const { notify } = useToast();
  const [storage, setStorage] = useState<Row | null>(null);
  useEffect(() => {
    if (!canWrite || detail.offer.origin === "reference") return;
    let active = true;
    jsonRequest(
      "/api/media-storage/status?" +
        new URLSearchParams({ store: detail.offer.store_id }),
    )
      .then((result) => {
        if (active) setStorage(result);
      })
      .catch(() => {
        if (active) setStorage({ status: "unavailable" });
      });
    return () => {
      active = false;
    };
  }, [canWrite, detail.offer.id, detail.offer.origin]);
  const [files, setFiles] = useState<Row[]>(detail.draftMedia || []),
    [preview, setPreview] = useState<Row | null>(null),
    [progress, setProgress] = useState<string | null>(null),
    [removing, setRemoving] = useState<Row | null>(null);
  useEffect(() => setFiles(detail.draftMedia || []), [detail.draftMedia]);
  const pictures = detail.offer.ml?.pictures || [];
  const videoId = detail.offer.ml?.videoId;
  const youtubeId =
    typeof videoId === "string" && /^[\w-]{11}$/.test(videoId) ? videoId : null;
  const permalink =
    detail.offer.ml?.permalink ||
    (detail.offer.ml_id && /^MLB\d+$/.test(detail.offer.ml_id)
      ? `https://produto.mercadolivre.com.br/${detail.offer.ml_id.replace(/^MLB/, "MLB-")}-_JM`
      : null);
  async function upload(selected: FileList | null) {
    if (!selected?.length || busy) return;
    const list = [...selected];
    if (list.some((file) => !file.size || file.size > 3 * 1024 * 1024)) {
      notify("Cada foto ou vídeo deve ter até 3 MB.", "error");
      return;
    }
    if (files.length + list.length > 30) {
      notify("Limite de 30 arquivos em rascunho por anúncio.", "error");
      return;
    }
    onWorking(true);
    let saved = 0;
    try {
      for (let i = 0; i < list.length; i++) {
        setProgress(`Enviando ${i + 1} de ${list.length}…`);
        const body = new FormData();
        body.set("file", list[i]);
        body.set("requestId", crypto.randomUUID());
        body.set("offerVersion", String(detail.offer.version));
        const response = await trackedFetch(
          `/api/offers/${detail.offer.id}/media`,
          { method: "POST", body },
        );
        const asset = await response.json();
        if (!response.ok)
          throw new Error(asset.error || "Não foi possível enviar a mídia.");
        setFiles((current) => [
          ...current.filter((row) => row.id !== asset.id),
          asset,
        ]);
        saved++;
      }
      notify(
        `${saved} ${saved === 1 ? "arquivo preparado" : "arquivos preparados"} em rascunho.`,
      );
    } catch (error) {
      notify(
        (error as Error).message +
          (saved ? ` ${saved} arquivos anteriores foram preservados.` : ""),
        "error",
      );
    } finally {
      setProgress(null);
      onWorking(false);
      if (saved) onChanged();
    }
  }
  return (
    <>
      <section className="panel listing-media-panel">
        <div className="panel-heading">
          <div>
            <h2>Fotos e vídeos publicados</h2>
            <p className="small muted">
              Última consulta:{" "}
              {detail.offer.ml
                ? date(detail.offer.ml.observedAt)
                : "Ainda não sincronizado"}
              .
            </p>
          </div>
          <div className="heading-actions">
            {permalink && (
              <a
                className="button compact"
                href={permalink}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink size={14} />
                Ver no ML
              </a>
            )}
            {detail.mlConnection?.status === "connected" && canWrite && (
              <button
                className="button compact"
                disabled={busy}
                onClick={onRefresh}
              >
                Atualizar mídia do ML
              </button>
            )}
          </div>
        </div>
        <div className="listing-media-gallery">
          {pictures.map((picture: Row, index: number) => (
            <button
              key={picture.id || index}
              className="media-tile"
              disabled={!picture.url}
              onClick={() =>
                setPreview({
                  ...picture,
                  kind: "image",
                  name: `Foto ${index + 1} · ${detail.offer.title}`,
                })
              }
            >
              <MediaImage
                src={picture.url}
                alt={`Foto ${index + 1} de ${detail.offer.title}`}
              />
              <span>
                {index === 0 ? "Foto principal" : `Foto ${index + 1}`}
              </span>
            </button>
          ))}
          {videoId && (
            <button
              className="media-tile video-tile"
              onClick={() =>
                setPreview({
                  kind: youtubeId ? "youtube" : "legacy",
                  videoId: youtubeId || videoId,
                  name: "Vídeo publicado",
                  permalink,
                })
              }
            >
              <Play size={30} />
              <span>Vídeo publicado</span>
            </button>
          )}
        </div>
        {!pictures.length && (
          <p className="media-empty">
            <ImageIcon size={22} />A consulta não retornou fotos. Sincronize o
            anúncio para conferir a mídia atual.
          </p>
        )}
        {!videoId && (
          <p className="small muted">
            Vídeo não informado nesta consulta. Clips podem estar disponíveis na
            página do anúncio no ML.
          </p>
        )}
      </section>
      {detail.offer.origin !== "reference" && (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Mídia em rascunho</h2>
              <p className="small muted">
                Prepare novas fotos e vídeos. Estes arquivos ainda não foram
                publicados no Mercado Livre.
              </p>
            </div>
            {canWrite && (
              <label
                className={
                  "button " +
                  (busy || storage?.status !== "ready"
                    ? "is-disabled"
                    : "primary")
                }
              >
                {progress ? (
                  <LoaderCircle className="spin" size={15} />
                ) : (
                  <Upload size={15} />
                )}
                {progress || "Adicionar arquivos"}
                <input
                  className="sr-only"
                  type="file"
                  accept="image/jpeg,image/png,image/webp,video/mp4,video/webm"
                  multiple
                  disabled={busy || storage?.status !== "ready"}
                  aria-label="Adicionar fotos e vídeos em rascunho"
                  onChange={(event) => {
                    void upload(event.target.files);
                    event.target.value = "";
                  }}
                />
              </label>
            )}
          </div>
          <p className="small muted">
            JPG, PNG, WebP, MP4 ou WebM · até 3 MB por arquivo · armazenamento
            privado no Google Drive.
          </p>
          {canWrite && (
            <div className="media-storage-status" role="status">
              {!storage ? (
                <span>
                  <LoaderCircle className="spin" size={14} />
                  Verificando armazenamento…
                </span>
              ) : storage.status === "ready" ? (
                <span className="green">Armazenamento pronto para envio.</span>
              ) : (
                <span>
                  Conecte o Google Drive desta loja para enviar arquivos.{" "}
                  {storage.configureUrl && (
                    <a href={storage.configureUrl}>Configurar Google Drive</a>
                  )}
                </span>
              )}
            </div>
          )}
          <div className="listing-media-gallery draft-gallery">
            {files.map((file) => (
              <div className="media-draft" key={file.id}>
                <button className="media-tile" onClick={() => setPreview(file)}>
                  {file.kind === "image" ? (
                    <MediaImage src={file.url} alt={file.name} />
                  ) : (
                    <Play size={30} />
                  )}
                  <span title={file.name}>{file.name}</span>
                </button>
                <div>
                  <span className="small muted">
                    Rascunho · {(file.bytes / 1024 / 1024).toFixed(1)} MB
                  </span>
                  {canWrite && (
                    <button
                      className="icon-button danger-text"
                      disabled={busy}
                      aria-label={`Remover rascunho ${file.name}`}
                      onClick={() => setRemoving(file)}
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
          {!files.length && (
            <p className="small muted">Nenhum arquivo em rascunho.</p>
          )}
        </section>
      )}
      {preview && (
        <Modal title={preview.name} onClose={() => setPreview(null)}>
          <div className="media-preview">
            {preview.kind === "image" && (
              <MediaImage
                src={preview.url}
                alt={preview.name}
                eager
                className="media-preview-image"
              />
            )}
            {preview.kind === "video" && (
              <MediaVideo src={preview.url} name={preview.name} />
            )}
            {preview.kind === "youtube" && (
              <iframe
                src={`https://www.youtube-nocookie.com/embed/${preview.videoId}`}
                title="Vídeo do anúncio"
                allow="fullscreen"
                allowFullScreen
              />
            )}
            {preview.kind === "legacy" && (
              <p>
                O ML retornou uma referência de vídeo sem endereço de
                reprodução.{" "}
                <a
                  href={preview.permalink}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Ver na página do anúncio
                </a>
                .
              </p>
            )}
          </div>
        </Modal>
      )}
      {removing && (
        <Modal
          title="Remover mídia em rascunho"
          onClose={() => !busy && setRemoving(null)}
        >
          <p>
            Remover {removing.name}? As fotos e vídeos publicados no Mercado
            Livre permanecem intactos.
          </p>
          <div className="form-footer">
            <button
              className="button"
              disabled={busy}
              onClick={() => setRemoving(null)}
            >
              Cancelar
            </button>
            <button
              className="button danger"
              disabled={busy}
              onClick={async () => {
                onWorking(true);
                try {
                  await jsonRequest(
                    `/api/listing-media/${removing.id}`,
                    {},
                    "DELETE",
                  );
                  setFiles((current) =>
                    current.filter((file) => file.id !== removing.id),
                  );
                  setRemoving(null);
                  notify("Rascunho removido.");
                  onChanged();
                } catch (error) {
                  notify((error as Error).message, "error");
                } finally {
                  onWorking(false);
                }
              }}
            >
              {busy && <LoaderCircle className="spin" size={15} />}Remover
              rascunho
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
