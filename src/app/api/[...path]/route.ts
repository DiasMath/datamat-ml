import { todayReport } from "@/server/today";
import { navigationReport, searchOffers } from "@/server/navigation";
import { after, NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { workspaceActor, HttpError } from "@/server/access";
import { initializeDatabase, DatabaseConfigurationError } from "@/server/db";
import * as service from "@/server/services";
import * as ml from "@/server/mercadolivre";
import { oauthPopupResponse } from "@/server/oauth-popup";
import { refreshListingIndicators } from "@/server/listing-indicators";
import * as drive from "@/server/google-drive";
import * as media from "@/server/listing-media";
import { receiveNotification } from "@/server/ml-notifications";
import { analyticsReport, refreshAnalytics } from "@/server/analytics";
import {
  routineReport,
  refreshRoutine,
  routineTask,
  authorizeCron,
} from "@/server/routine";
import * as competitors from "@/server/competitors";
import * as extension from "@/server/extension";
import { applyApprovedPrice } from "@/server/ml-price-application";
import { batchListingStatus } from "@/server/ml-status";
import * as campaign from "@/server/campaigns";
import { refreshCatalog } from "@/server/catalog-refresh";
import { csvCell } from "@/domain/csv";
import {
  offersWorkbook,
  importTemplateWorkbook,
  offerColumns,
  offerValues,
} from "@/server/spreadsheets";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";
const headers = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};
type Context = { params: Promise<{ path: string[] }> };
function response(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers });
}
async function handle(req: NextRequest, context: Context) {
  try {
    const { path } = await context.params;
    const [resource, key, action] = path;
    const extensionRequest = resource === "extension";
    const notification =
      resource === "mercadolivre" &&
      key === "notifications" &&
      path.length === 2 &&
      req.method === "POST";
    if (req.method !== "GET" && !notification && !extensionRequest) {
      const origin = req.headers.get("origin"),
        allowed = process.env.APP_URL || "http://localhost:3000";
      if (origin !== new URL(allowed).origin)
        throw new HttpError(403, "Origem da operação não autorizada");
    }
    const mediaUpload =
      resource === "offers" &&
      key &&
      action === "media" &&
      path.length === 3 &&
      req.method === "POST";
    let body: unknown = {};
    if (req.method !== "GET" && !mediaUpload) {
      const text = await req.text();
      if (Buffer.byteLength(text) > (notification ? 64000 : 2_000_000))
        throw new HttpError(413, "Envie arquivos de até 2 MB");
      body = text ? JSON.parse(text) : {};
    }
    await initializeDatabase();
    if (notification) {
      const queued = new Set<string>();
      const result = await receiveNotification(body, (storeId) =>
        queued.add(storeId),
      );
      if (queued.size)
        after(async () => {
          try {
            const actor = await workspaceActor();
            // The worker verifies official resources; webhook contents never update sales directly.
            for (const store of queued)
              await refreshRoutine(
                actor,
                new URLSearchParams({ store }),
                120000 / queued.size,
              );
          } catch {
            console.error(
              "Falha no processamento da fila ML; a próxima atualização retomará as pendências",
            );
          }
        });
      return response(result, 202);
    }
    if (resource === "auth" || resource === "users")
      throw new HttpError(
        404,
        "Login e usuários locais foram removidos; o acesso será integrado ao portal",
      );
    const actor = await workspaceActor();
    if (
      resource === "media-storage" &&
      key === "status" &&
      path.length === 2 &&
      req.method === "GET"
    )
      return response(
        await media.mediaStorageStatus(
          actor,
          req.nextUrl.searchParams.get("store") || actor.stores[0]?.id || "",
        ),
      );
    if (resource === "google-drive") {
      if (!key && req.method === "GET")
        return response(
          await drive.list(
            actor,
            req.nextUrl.searchParams.get("store") || "all",
          ),
        );
      if (key === "callback" && req.method === "GET") {
        const params = req.nextUrl.searchParams,
          cookie = req.cookies.get("datamat_drive_state")?.value;
        const state = await drive.authorizationContext(actor, params, cookie);
        const destination = new URL(
          "/configuracoes",
          process.env.APP_URL || "http://localhost:3000",
        );
        destination.search = new URLSearchParams({
          store: state.store_id,
          configTab: "integrations",
        }).toString();
        try {
          await drive.finishAuthorization(actor, params, cookie);
          destination.searchParams.set("driveAuthorization", "connected");
        } catch (error) {
          destination.searchParams.set("driveAuthorization", "failed");
          destination.searchParams.set(
            "driveMessage",
            error instanceof HttpError
              ? error.message
              : "Não foi possível concluir a conexão do Google Drive",
          );
        }
        const html = oauthPopupResponse(
          destination,
          state.channel,
          "google-drive",
        );
        const result = new NextResponse(await html.text(), {
          headers: html.headers,
        });
        result.cookies.delete({
          name: "datamat_drive_state",
          path: "/api/google-drive/callback",
        });
        return result;
      }
      if (key && action === "application" && req.method === "PUT")
        return response(await drive.configure(actor, key, body));
      if (key && action === "authorize" && req.method === "POST") {
        const p = z.object({ popupChannel: z.uuid() }).parse(body);
        const flow = await drive.startAuthorization(actor, key, p.popupChannel);
        const result = response({ url: flow.url });
        result.cookies.set("datamat_drive_state", flow.state, {
          httpOnly: true,
          sameSite: "lax",
          secure: drive.redirectUri().startsWith("https:"),
          maxAge: 600,
          path: "/api/google-drive/callback",
        });
        return result;
      }
      if (key && action === "disconnect" && req.method === "POST")
        return response(
          await drive.disconnect(
            actor,
            key,
            z.object({ version: z.number() }).parse(body).version,
          ),
        );
      throw new HttpError(404, "Operação do Google Drive não encontrada");
    }
    if (mediaUpload) {
      const reader = req.body?.getReader();
      if (!reader) throw new HttpError(422, "Arquivo ausente");
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > media.MAX_MEDIA_BYTES + 64000) {
          await reader.cancel();
          throw new HttpError(413, "Cada foto ou vídeo deve ter até 3 MB");
        }
        chunks.push(value);
      }
      const form = await new Response(new Uint8Array(Buffer.concat(chunks)), {
        headers: { "Content-Type": req.headers.get("content-type") || "" },
      }).formData();
      const file = form.get("file");
      if (!(file instanceof File)) throw new HttpError(422, "Arquivo ausente");
      return response(
        await media.uploadMedia(actor, key, {
          file,
          requestId: form.get("requestId"),
          offerVersion: form.get("offerVersion"),
        }),
      );
    }
    if (
      resource === "listing-media" &&
      key &&
      path.length === 2 &&
      req.method === "GET"
    )
      return media.readMedia(actor, key, req.headers.get("range"));
    if (
      resource === "listing-media" &&
      key &&
      path.length === 2 &&
      req.method === "DELETE"
    )
      return response(await media.deleteMedia(actor, key));
    if (
      resource === "catalog" &&
      key === "indicators" &&
      path.length === 2 &&
      req.method === "POST"
    )
      return response(await refreshListingIndicators(actor, body));
    if (
      resource === "offers" &&
      key &&
      action === "ml-competition" &&
      path.length === 3 &&
      req.method === "POST"
    )
      return response(await ml.refreshCompetition(actor, key));
    if (
      resource === "catalog" &&
      key === "refresh" &&
      path.length === 2 &&
      req.method === "POST"
    )
      return response(
        await refreshCatalog(actor, req.nextUrl.searchParams, body),
      );
    if (resource === "campaigns") {
      if (req.method === "GET" && path.length === 1)
        return response(
          await campaign.campaigns(actor, req.nextUrl.searchParams),
        );
      if (req.method === "POST" && path.length === 1)
        return response(await campaign.saveCampaigns(actor, body));
      if (
        req.method === "POST" &&
        key &&
        action === "task" &&
        path.length === 3
      )
        return response(await campaign.campaignTask(actor, key));
      if (req.method === "DELETE" && key && path.length === 2)
        return response(await campaign.deleteCampaign(actor, key, body));
      throw new HttpError(404, "Operação de campanha não encontrada");
    }
    if (extensionRequest) {
      const extensionId = req.headers.get("x-datamat-extension");
      const origin =
        req.headers.get("origin") ||
        (extensionId && /^[a-p]{32}$/.test(extensionId)
          ? `chrome-extension://${extensionId}`
          : null);
      const deviceActor = await extension.extensionActor(
        actor,
        req.headers.get("authorization"),
        origin,
      );
      if (req.method === "GET" && key === "offers" && path.length === 2)
        return response(await extension.extensionOffers(deviceActor));
      if (
        req.method === "GET" &&
        key === "offers" &&
        action &&
        path.length === 3
      )
        return response(await extension.extensionOffer(deviceActor, action));
      if (req.method === "POST" && key === "captures" && path.length === 2)
        return response(await extension.extensionCapture(deviceActor, body));
      throw new HttpError(404, "Recurso não disponível para a extensão");
    }
    if (
      req.method === "DELETE" &&
      resource === "competitors" &&
      key &&
      path.length === 2
    )
      return response(
        await competitors.changeCompetitor(actor, key, body, "delete"),
      );
    if (
      resource === "mercadolivre" &&
      key === "callback" &&
      req.method === "GET"
    ) {
      let returnPath = "/configuracoes?configTab=integrations";
      let popupChannel: string | null = null;
      try {
        const context = await ml.authorizationContext(
          actor,
          req.nextUrl.searchParams,
          req.cookies.get(ml.ML_STATE_COOKIE)?.value,
        );
        returnPath = context.path;
        popupChannel = context.popupChannel;
      } catch {}
      const destination = new URL(
        returnPath,
        process.env.APP_URL || "http://localhost:3000",
      );
      try {
        const result = await ml.finishAuthorization(
          actor,
          req.nextUrl.searchParams,
          req.cookies.get(ml.ML_STATE_COOKIE)?.value,
        );
        if (!destination.searchParams.has("store"))
          destination.searchParams.set("store", result.storeId);
        destination.searchParams.set("mlAuthorization", "connected");
      } catch (e) {
        destination.searchParams.set("mlAuthorization", "failed");
        destination.searchParams.set(
          "mlMessage",
          e instanceof HttpError
            ? e.message
            : "Não foi possível validar a autorização do Mercado Livre; tente conectar novamente",
        );
      }
      const popupResponse = popupChannel
        ? oauthPopupResponse(destination, popupChannel)
        : null;
      const result = popupResponse
        ? new NextResponse(popupResponse.body, {
            headers: popupResponse.headers,
          })
        : NextResponse.redirect(destination);
      result.headers.set("Cache-Control", "no-store");
      result.headers.set("Referrer-Policy", "no-referrer");
      result.cookies.set(ml.ML_STATE_COOKIE, "", {
        httpOnly: true,
        sameSite: "lax",
        secure: destination.protocol === "https:",
        path: "/api/mercadolivre/callback",
        maxAge: 0,
      });
      return result;
    }
    if (
      req.method === "DELETE" &&
      key &&
      !action &&
      ["offers", "tasks", "notes"].includes(resource)
    )
      return response(
        await service.deleteRecord(
          actor,
          resource as "offers" | "tasks" | "notes",
          key,
          body,
        ),
      );
    if (req.method === "GET") {
      if (resource === "competitors" && !key && path.length === 1)
        return response(
          await competitors.competitors(actor, req.nextUrl.searchParams),
        );
      if (resource === "extension-devices" && !key && path.length === 1)
        return response(await extension.extensionDevices(actor));
      if (resource === "routine" && !key && path.length === 1)
        return response(await routineReport(actor, req.nextUrl.searchParams));
      if (resource === "routine" && key === "scheduled" && path.length === 2) {
        authorizeCron(req.headers.get("authorization"));
        return response(
          await refreshRoutine(
            actor,
            new URLSearchParams({ store: "all" }),
            220000,
          ),
        );
      }
      if (resource === "analytics" && !key)
        return response(await analyticsReport(actor, req.nextUrl.searchParams));
      if (resource === "today" && !key && path.length === 1)
        return response(await todayReport(actor, req.nextUrl.searchParams));
      if (resource === "navigation" && path.length === 1)
        return response(
          await navigationReport(actor, req.nextUrl.searchParams),
        );
      if (resource === "search" && path.length === 1)
        return response(await searchOffers(actor, req.nextUrl.searchParams));
      if (resource === "workspace")
        return response(
          await service.workspace(actor, req.nextUrl.searchParams),
        );
      if (resource === "offers" && key)
        return response(await service.offerDetail(actor, key));
      if (resource === "insights" && key)
        return response(await service.insights(actor, key));
      if (resource === "export") {
        if (key === "template") {
          return new NextResponse(
            new Uint8Array(await importTemplateWorkbook()),
            {
              headers: {
                ...headers,
                "Content-Type":
                  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "Content-Disposition":
                  'attachment; filename="datamat-modelo-anuncios.xlsx"',
              },
            },
          );
        }
        const data = await service.workspace(actor, req.nextUrl.searchParams);
        if (req.nextUrl.searchParams.get("format") === "xlsx") {
          return new NextResponse(
            new Uint8Array(await offersWorkbook(data.offers)),
            {
              headers: {
                ...headers,
                "Content-Type":
                  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "Content-Disposition":
                  'attachment; filename="datamat-anuncios.xlsx"',
              },
            },
          );
        }
        if (req.nextUrl.searchParams.get("format") === "json")
          return new NextResponse(
            JSON.stringify(
              { ...data, user: undefined, users: undefined },
              null,
              2,
            ),
            {
              headers: {
                ...headers,
                "Content-Type": "application/json",
                "Content-Disposition": 'attachment; filename="datamat-bi.json"',
              },
            },
          );
        const columns = offerColumns;
        const rows = data.offers.map(offerValues);
        return new NextResponse(
          "\uFEFF" +
            [columns, ...rows]
              .map((r) => r.map(csvCell).join(";"))
              .join("\r\n"),
          {
            headers: {
              ...headers,
              "Content-Type": "text/csv; charset=utf-8",
              "Content-Disposition":
                'attachment; filename="datamat-anuncios.csv"',
            },
          },
        );
      }
    }
    if (req.method === "POST" || req.method === "PATCH") {
      if (
        resource === "today" &&
        key === "refresh" &&
        path.length === 2 &&
        req.method === "POST"
      ) {
        await refreshRoutine(actor, req.nextUrl.searchParams, 55000, true);
        return response(await todayReport(actor, req.nextUrl.searchParams));
      }

      if (
        resource === "proposals" &&
        key &&
        action === "apply-ml" &&
        path.length === 3 &&
        req.method === "POST"
      )
        return response(await applyApprovedPrice(actor, key, body));
      if (
        resource === "routine" &&
        key === "task" &&
        path.length === 2 &&
        req.method === "POST"
      )
        return response(await routineTask(actor, body));
      if (resource === "competitors" && !key && path.length === 1)
        return response(await competitors.saveCompetitor(actor, body));
      if (
        resource === "competitors" &&
        key &&
        action === "dismiss" &&
        path.length === 3
      )
        return response(
          await competitors.changeCompetitor(actor, key, body, "dismiss"),
        );
      if (
        resource === "competitors" &&
        key &&
        action === "task" &&
        path.length === 3
      )
        return response(await competitors.competitorTask(actor, key));
      if (resource === "extension-devices" && !key && path.length === 1)
        return response(await extension.pairExtension(actor, body));
      if (
        resource === "extension-devices" &&
        key &&
        action === "revoke" &&
        path.length === 3
      )
        return response(await extension.revokeExtension(actor, key));
      if (
        resource === "routine" &&
        key === "refresh" &&
        path.length === 2 &&
        req.method === "POST"
      )
        return response(await refreshRoutine(actor, req.nextUrl.searchParams));
      if (
        resource === "connections" &&
        action === "application" &&
        path.length === 3 &&
        req.method === "POST"
      )
        return response(await ml.saveApplication(actor, key, body));
      if (
        resource === "analytics" &&
        key === "refresh" &&
        !action &&
        req.method === "POST"
      )
        return response(
          await refreshAnalytics(actor, req.nextUrl.searchParams),
        );
      if (
        resource === "connections" &&
        action === "authorize" &&
        req.method === "POST"
      ) {
        const settings = z
          .object({
            returnTo: z.string().max(8000).optional(),
            popupChannel: z.uuid().optional(),
          })
          .parse(body);
        const { state, url } = await ml.startAuthorization(
          actor,
          key,
          settings.returnTo,
          settings.popupChannel,
        );
        const result = response({ url });
        result.cookies.set(ml.ML_STATE_COOKIE, state, {
          httpOnly: true,
          sameSite: "lax",
          secure:
            new URL(process.env.APP_URL || "http://localhost:3000").protocol ===
            "https:",
          path: "/api/mercadolivre/callback",
          maxAge: 600,
        });
        return result;
      }
      if (
        resource === "connections" &&
        action === "disconnect" &&
        req.method === "POST"
      )
        return response(await ml.disconnect(actor, key));
      if (
        resource === "offers" &&
        action === "ml-quote" &&
        req.method === "POST"
      )
        return response(await ml.quoteTariff(actor, key, body));
      if (
        resource === "offers" &&
        action === "ml-metrics" &&
        req.method === "POST"
      )
        return response(await ml.refreshMetrics(actor, key));
      if (
        resource === "offers" &&
        action === "quality-task" &&
        req.method === "POST"
      )
        return response(await ml.createQualityTask(actor, key, body));
      if (
        resource === "offers" &&
        key === "batch-delete" &&
        path.length === 2 &&
        req.method === "POST"
      )
        return response(await service.batchDeleteOffers(actor, body));
      if (
        resource === "offers" &&
        key === "batch-ml-status" &&
        path.length === 2 &&
        req.method === "POST"
      )
        return response(await batchListingStatus(actor, body));
      if (resource === "offers" && key === "batch")
        return response(await service.batchOffers(actor, body));
      if (resource === "offers" && action === "costs")
        return response(await service.saveCosts(actor, key, body));
      if (resource === "offers" && action === "simulate")
        return response(await service.simulate(actor, key, body, true));
      if (resource === "offers")
        return response(await service.saveOffer(actor, body, key));
      if (resource === "proposals" && key)
        return response(await service.decideProposal(actor, key, body));
      if (resource === "proposals")
        return response(await service.createProposal(actor, body));
      if (resource === "tasks")
        return response(await service.saveTask(actor, body, key));
      if (resource === "notes" && action === "task")
        return response(await service.noteToTask(actor, key, body));
      if (resource === "notes")
        return response(await service.saveNote(actor, body, key));
      if (resource === "parameters" && key)
        return response(await service.saveParameters(actor, key, body));
      if (resource === "stores" && key)
        return response(await service.updateStore(actor, key, body));
      if (resource === "stores")
        return response(await service.createStore(actor, body));
      if (resource === "imports" && key === "preview")
        return response(await service.importPreview(actor, body));
      if (resource === "imports" && key === "confirm")
        return response(await service.confirmImport(actor, body));
      if (resource === "connections" && key)
        return response(await service.sync(actor, key, body));
    }
    throw new HttpError(404, "Operação não encontrada");
  } catch (e) {
    if (e instanceof DatabaseConfigurationError)
      return response({ error: e.message }, 503);
    if (e instanceof HttpError) return response({ error: e.message }, e.status);
    if (e instanceof z.ZodError)
      return response(
        {
          error: e.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join(";"),
        },
        422,
      );
    if (e instanceof SyntaxError)
      return response({ error: "JSON inválido" }, 400);
    if (e instanceof Error && e.message.includes("UNIQUE constraint"))
      return response(
        { error: "Um registro com essa identificação já existe" },
        409,
      );
    console.error(
      "Erro interno:",
      e instanceof Error ? e.stack : "Erro desconhecido",
    );
    return response(
      {
        error:
          "Não foi possível concluir. Tente novamente ou consulte os registros do servidor.",
      },
      500,
    );
  }
}
export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const PUT = handle;
export const DELETE = handle;
