// src/cli/commands/doctor.ts — preflight: config, credentials, repo + coordination category reachable.
import { createGitHubClient, createLogger } from "@kleroterion/koine";
import type { Command } from "commander";
import { resolveAuth } from "../../config/auth.js";
import { type CliFlags, loadConfig } from "../../config/load.js";
import { findCategoryId } from "../../github/discussions.js";
import { globals } from "./_shared.js";

export function registerDoctor(program: Command): void {
  program
    .command("doctor")
    .description("Validate config, credentials, repo access, and the coordination Discussion category.")
    .action(async (_local: unknown, cmd: Command) => {
      const g = globals(cmd);
      const out: string[] = [];
      const check = (ok: boolean, label: string, hint = "") =>
        out.push(`${ok ? "✓" : "✗"} ${label}${ok ? "" : `  → ${hint}`}`);

      let cfgOk = true;
      let cfg: ReturnType<typeof loadConfig> | null = null;
      try {
        cfg = loadConfig({ env: process.env, cli: g as CliFlags });
      } catch (e) {
        cfgOk = false;
        check(false, "config valid", e instanceof Error ? e.message : String(e));
      }
      if (cfg) check(true, `config valid (repo=${cfg.repo})`);

      let authOk = true;
      try {
        resolveAuth(process.env);
      } catch (e) {
        authOk = false;
        check(false, "GitHub credentials present", e instanceof Error ? e.message : String(e));
      }
      if (authOk) check(true, "GitHub credentials present");

      if (cfg && authOk) {
        const log = createLogger({ level: "silent" });
        try {
          const gh = await createGitHubClient(resolveAuth(process.env), log);
          const [owner, name] = cfg.repo.split("/") as [string, string];
          await gh.withRest("read", (o) => o.repos.get({ owner, repo: name }));
          check(true, `repo reachable (${cfg.repo})`);
          const cat = await findCategoryId(gh, owner, name, cfg.coordination.category);
          check(
            Boolean(cat),
            `coordination category "${cfg.coordination.category}" exists`,
            "create it in repo Settings → Discussions (Boule's bootstrap provisions it)",
          );
        } catch (e) {
          check(false, "GitHub reachable", e instanceof Error ? e.message : String(e));
        }
      }

      process.stdout.write(`${out.join("\n")}\n`);
      if (!cfgOk || !authOk) process.exitCode = 2;
    });
}
