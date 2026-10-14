import { loadEnvConfig } from "@next/env";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  openSync,
  closeSync,
  unlinkSync,
  existsSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { backendOrigin, readMarketBackend } from "./lib/market-backend";
import type {
  MarketResource,
  MarketObservation,
} from "../src/domain/market-research";
import {
  marketConfigSchema,
  startMarketQueue,
  nextMarketTask,
  acceptMarketObservation,
  marketCsv,
  configHash,
  type MarketState,
} from "./lib/market-queue";

async function main() {
  const args = process.argv.slice(2);
  let configFile = "config/market-research.example.json",
    output = "",
    backend = "",
    resume = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--config" && args[i + 1]) configFile = args[++i];
    else if (args[i] === "--out" && args[i + 1]) output = args[++i];
    else if (args[i] === "--backend" && args[i + 1])
      backend = backendOrigin(args[++i]);
    else if (args[i] === "--resume") resume = true;
    else
      throw new Error(
        "Use --config arquivo.json --out diretório [--resume] [--backend https://seu-datamat]",
      );
  }
  if (resume && !output)
    throw new Error("Informe --out para retomar o mesmo snapshot");
  const config = marketConfigSchema.parse(
    JSON.parse(readFileSync(resolve(configFile), "utf8")),
  );
  const directory = resolve(
    output ||
      `data/market-research/${new Date().toISOString().replaceAll(":", "-")}`,
  );
  mkdirSync(directory, { recursive: true });
  const lock = join(directory, ".lock"),
    checkpoint = join(directory, "checkpoint.json");
  if (existsSync(lock)) {
    const pid = Number(readFileSync(lock, "utf8"));
    let active = false;
    try {
      process.kill(pid, 0);
      active = true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ESRCH") active = true;
    }
    if (active || !resume)
      throw new Error("Snapshot ocupado; evite duas coletas simultâneas");
    unlinkSync(lock);
  }
  const fd = openSync(lock, "wx", 0o600);
  writeFileSync(fd, String(process.pid));
  closeSync(fd);
  const cleanLock = () => {
    if (existsSync(lock)) unlinkSync(lock);
  };
  let interrupted = false;
  const interrupt = () => {
    interrupted = true;
    console.log(
      "Interrupção recebida; preservando o checkpoint da consulta atual.",
    );
  };
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", interrupt);
  try {
    if (existsSync(checkpoint) !== resume)
      throw new Error(
        resume
          ? "Checkpoint não encontrado"
          : "Snapshot já existe; use --resume ou outro --out",
      );
    const state: MarketState = resume
      ? JSON.parse(readFileSync(checkpoint, "utf8"))
      : startMarketQueue(config);
    if (state.version !== 1 || state.config_hash !== configHash(config))
      throw new Error(
        "Configuração diferente do checkpoint; crie um novo snapshot",
      );
    state.resource_limit_reached ||= false;
    const save = () => {
      const temporary = checkpoint + ".tmp";
      writeFileSync(temporary, JSON.stringify(state, null, 2), { mode: 0o600 });
      renameSync(temporary, checkpoint);
      writeFileSync(
        join(directory, "observations.jsonl"),
        state.observations.map((o) => JSON.stringify(o)).join("\n") +
          (state.observations.length ? "\n" : ""),
      );
      writeFileSync(
        join(directory, "observations.csv"),
        "\ufeff" + marketCsv(state),
      );
      const latest = new Map(
        state.observations.map((o) => [JSON.stringify(o.resource), o]),
      );
      writeFileSync(
        join(directory, "summary.json"),
        JSON.stringify(
          {
            started_at: state.started_at,
            updated_at: state.updated_at,
            resources: state.tasks.length,
            completed: state.done.length,
            observed: [...latest.values()].filter((o) => o.status === "ok")
              .length,
            blocked: [...latest.values()].filter((o) => o.status === "blocked")
              .length,
            pending: state.tasks.length - state.done.length,
            stopped_reason: state.stopped_reason,
            next_allowed_at: state.next_allowed_at,
            resource_limit_reached: state.resource_limit_reached,
            monthly_sales_available: false,
          },
          null,
          2,
        ),
      );
    };
    save();
    if (
      state.next_allowed_at &&
      Date.parse(state.next_allowed_at) > Date.now()
    ) {
      console.log(`Aguarde até ${state.next_allowed_at} antes de retomar.`);
      process.exitCode = 2;
      return;
    }
    // A stalled SDK or network call must not hold the process indefinitely.
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      watchdog = setTimeout(() => {
        state.stopped_reason = "timeout";
        state.updated_at = new Date().toISOString();
        save();
        console.log(
          "Prazo de 45 segundos atingido; consulta pendente preservada.",
        );
        cleanLock();
        process.exit(2);
      }, 45000);
    };
    arm();
    let read: (resource: MarketResource) => Promise<MarketObservation>;
    try {
      if (backend)
        read = (resource) => readMarketBackend(backend, config, resource);
      else {
        loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
        const { workspaceActor } = await import("../src/server/access");
        const { readMarketResource } =
          await import("../src/server/market-research");
        const actor = await workspaceActor();
        read = (resource) =>
          readMarketResource(
            actor,
            config.store_id,
            config.application_id,
            resource,
          );
      }
    } catch (error) {
      state.stopped_reason = "configuration_or_connection";
      state.updated_at = new Date().toISOString();
      save();
      throw error;
    } finally {
      clearTimeout(watchdog);
    }
    state.stopped_reason = null;
    let task = nextMarketTask(state);
    while (task && !interrupted) {
      console.log(
        `Consultando ${task.kind}: ${"id" in task ? task.id : "category_id" in task ? task.category_id : task.query} (${state.done.length}/${state.tasks.length})`,
      );
      arm();
      let proceed: boolean;
      try {
        const observation = await read(task);
        proceed = acceptMarketObservation(state, observation, config);
        save();
        console.log(
          `${observation.status}${observation.http_status ? ` HTTP ${observation.http_status}` : ""}${observation.note ? ` — ${observation.note}` : ""}`,
        );
      } catch (error) {
        state.stopped_reason = "configuration_or_connection";
        state.updated_at = new Date().toISOString();
        save();
        throw error;
      } finally {
        clearTimeout(watchdog);
      }
      if (!proceed) {
        process.exitCode = 2;
        break;
      }
      task = nextMarketTask(state);
      if (task && !interrupted)
        await new Promise((r) => setTimeout(r, config.interval_seconds * 1000));
    }
    if (interrupted) {
      state.stopped_reason = "interrupted";
      process.exitCode = 2;
    }
    if (!task && state.resource_limit_reached)
      state.stopped_reason = "resource_limit";
    save();
    console.log(
      `Snapshot salvo em ${directory}; ${state.done.length}/${state.tasks.length} recursos concluídos.`,
    );
  } finally {
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", interrupt);
    cleanLock();
  }
}
main().catch(() => {
  // Configuration/SDK exceptions can include credential paths; export no raw errors.
  console.error(
    "Coleta não iniciada ou interrompida. Verifique os argumentos, a configuração e a conexão existente; nenhum detalhe interno foi exibido.",
  );
  process.exitCode = 1;
});
