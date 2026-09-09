import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "bun:test";
import {
  TOKEN_EXCHANGE_GRANT,
  clearAppTokenCache,
  mintAppToken,
  mintGithubAppJwt,
} from "./app-auth.js";

function testPem(): string {
  return generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
}

describe("app auth", () => {
  it("mints a GitHub App installation token from a private key", async () => {
    clearAppTokenCache();
    const pem = testPem();
    const jwt = await mintGithubAppJwt("1234", pem);
    expect(jwt.split(".")).toHaveLength(3);
    const minted = await mintAppToken(
      { name: "github", grant: "github-app", appId: "1234", installationId: "99" },
      {
        privateKey: pem,
        fetchImpl: async (url, init) => {
          expect(String(url)).toContain("/app/installations/99/access_tokens");
          expect(String((init?.headers as Record<string, string>).authorization)).toMatch(/^Bearer ey/);
          return Response.json({ token: "ghs_install", expires_at: "2099-01-01T00:00:00Z" });
        },
      },
    );
    expect(minted).toMatchObject({ token: "ghs_install", source: "github-app", username: "x-access-token" });
  });

  it("exchanges the EKS workload OIDC token (RFC 8693)", async () => {
    clearAppTokenCache();
    const minted = await mintAppToken(
      {
        name: "linear",
        grant: "token-exchange",
        tokenUrl: "https://auth.example/token",
        audience: "linear",
        scope: "read",
      },
      {
        readWorkloadToken: () => "eks-sa-jwt",
        fetchImpl: async (url, init) => {
          expect(String(url)).toBe("https://auth.example/token");
          const body = String(init?.body ?? "");
          expect(body).toContain(encodeURIComponent(TOKEN_EXCHANGE_GRANT));
          expect(body).toContain("eks-sa-jwt");
          expect(body).not.toContain("BEGIN");
          return Response.json({ access_token: "lin_tmp", expires_in: 3600 });
        },
      },
    );
    expect(minted.source).toBe("oidc");
    expect(minted.token).toBe("lin_tmp");
  });
});
