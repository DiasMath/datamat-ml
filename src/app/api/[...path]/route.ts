import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { workspaceActor, HttpError } from "@/server/access";
import { initializeDatabase, DatabaseConfigurationError } from "@/server/db";
import * as service from "@/server/services";
import * as ml from "@/server/mercadolivre";
import { receiveNotification } from "@/server/ml-notifications";
import { analyticsReport, refreshAnalytics } from "@/server/analytics";
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
    const notification =
      resource === "mercadolivre" &&
      key === "notifications" &&
      path.length === 2 &&
      req.method === "POST";
    if (req.method !== "GET" && !notification) {
      const origin = req.headers.get("origin"),
        allowed = process.env.APP_URL || "http://localhost:3000";
      if (origin !== new URL(allowed).origin)
        throw new HttpError(403, "Origem da operação não autorizada");
    }
    let body: unknown = {};
    if (req.method !== "GET") {
      const text = await req.text();
      if (Buffer.byteLength(text) > (notification ? 64000 : 2_000_000))
        throw new HttpError(413, "Envie arquivos de até 2 MB");
      body = text ? JSON.parse(text) : {};
    }
    await initializeDatabase();
    if (notification) return response(await receiveNotification(body), 202);
    if (resource === "auth" || resource === "users")
      throw new HttpError(
        404,
        "Login e usuários locais foram removidos; o acesso será integrado ao portal",
      );
    const actor = await workspaceActor();
    if (
      resource === "mercadolivre" &&
      key === "callback" &&
      req.method === "GET"
    ) {
      const destination = new URL(
        "/configuracoes?configTab=integrations",
        process.env.APP_URL || "http://localhost:3000",
      );
      try {
        const result = await ml.finishAuthorization(
          actor,
          req.nextUrl.searchParams,
          req.cookies.get(ml.ML_STATE_COOKIE)?.value,
        );
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
      const result = NextResponse.redirect(destination);
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
      if (resource === "analytics" && !key)
        return response(await analyticsReport(actor, req.nextUrl.searchParams));
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
        const { state, url } = await ml.startAuthorization(actor, key);
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
export const DELETE = handle;
