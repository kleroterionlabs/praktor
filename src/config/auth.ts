// src/config/auth.ts — resolve GitHub credentials for Praktor's OWN identity: its own GitHub App
// (PRAKTOR_APP_* trio) or a fine-grained PAT (PRAKTOR_GITHUB_TOKEN / GITHUB_TOKEN). Never Boule's App.
export type GitHubAuth =
  | { kind: "pat"; token: string }
  | { kind: "app"; appId: string; installationId: string; privateKey: string };

export interface AuthConfig {
  github: GitHubAuth;
}

/** Decode a base64-or-PEM private key (CI usually stores a single-line base64 blob). */
function decodeKey(raw: string): string {
  const v = raw.trim();
  if (v.includes("BEGIN") && v.includes("PRIVATE KEY")) return v;
  try {
    return Buffer.from(v, "base64").toString("utf8");
  } catch {
    return v;
  }
}

export function resolveAuth(env: NodeJS.ProcessEnv): AuthConfig {
  // Praktor has its OWN GitHub App identity — it never borrows Boule's credentials.
  const appId = env.PRAKTOR_APP_ID;
  const installationId = env.PRAKTOR_APP_INSTALLATION_ID;
  const privateKey = env.PRAKTOR_APP_PRIVATE_KEY;
  const token = env.PRAKTOR_GITHUB_TOKEN || env.GITHUB_TOKEN;

  if (appId && installationId && privateKey) {
    return { github: { kind: "app", appId, installationId, privateKey: decodeKey(privateKey) } };
  }
  if (token) return { github: { kind: "pat", token } };
  throw Object.assign(
    new Error(
      "no GitHub credentials: set the PRAKTOR_APP_* trio (Praktor's own App), or PRAKTOR_GITHUB_TOKEN/GITHUB_TOKEN",
    ),
    { name: "UsageError" },
  );
}
