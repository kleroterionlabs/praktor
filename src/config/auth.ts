// src/config/auth.ts — resolve GitHub credentials for Praktor's OWN identity: its own GitHub App
// (PRAKTOR_APP_* trio) or a fine-grained PAT (PRAKTOR_GITHUB_TOKEN / GITHUB_TOKEN). Never Boule's App.
import { type AuthConfig, type GitHubAuth, decodePrivateKey } from "@kleroterion/koine";

export type { AuthConfig, GitHubAuth };

export function resolveAuth(env: NodeJS.ProcessEnv): AuthConfig {
  // Praktor has its OWN GitHub App identity — it never borrows Boule's credentials.
  const appId = env.PRAKTOR_APP_ID;
  const installationId = env.PRAKTOR_APP_INSTALLATION_ID;
  const privateKey = env.PRAKTOR_APP_PRIVATE_KEY;
  const token = env.PRAKTOR_GITHUB_TOKEN || env.GITHUB_TOKEN;

  if (appId && installationId && privateKey) {
    return { github: { kind: "app", appId, installationId, privateKey: decodePrivateKey(privateKey) } };
  }
  if (token) return { github: { kind: "pat", token } };
  throw Object.assign(
    new Error(
      "no GitHub credentials: set the PRAKTOR_APP_* trio (Praktor's own App), or PRAKTOR_GITHUB_TOKEN/GITHUB_TOKEN",
    ),
    { name: "UsageError" },
  );
}
