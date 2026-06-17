// src/config/auth.ts — resolve GitHub credentials. Reuses Boule's env names so Praktor drops into the
// same org/CI secrets: a fine-grained PAT (GITHUB_TOKEN) OR the GitHub App trio (BOULE_APP_*).
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
  const token = env.GITHUB_TOKEN || env.PRAKTOR_GITHUB_TOKEN || env.BOULE_GITHUB_TOKEN;
  const appId = env.BOULE_APP_ID || env.PRAKTOR_APP_ID;
  const installationId = env.BOULE_APP_INSTALLATION_ID || env.PRAKTOR_APP_INSTALLATION_ID;
  const privateKey = env.BOULE_APP_PRIVATE_KEY || env.PRAKTOR_APP_PRIVATE_KEY;

  if (appId && installationId && privateKey) {
    return { github: { kind: "app", appId, installationId, privateKey: decodeKey(privateKey) } };
  }
  if (token) return { github: { kind: "pat", token } };
  throw Object.assign(new Error("no GitHub credentials: set GITHUB_TOKEN, or the BOULE_APP_* trio"), {
    name: "UsageError",
  });
}
