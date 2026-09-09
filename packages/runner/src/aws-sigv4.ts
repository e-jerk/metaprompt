import { createHash, createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";

export type AwsCredentials = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
};

export type SignRequest = {
  method: string;
  url: URL;
  region: string;
  service: string;
  credentials: AwsCredentials;
  headers?: Record<string, string>;
  body?: string;
  timestamp?: Date;
};

function sha256Hex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

function amzDate(ts: Date): { amz: string; date: string } {
  const iso = ts.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amz: iso, date: iso.slice(0, 8) };
}

function canonicalQuery(url: URL): string {
  const pairs: Array<[string, string]> = [];
  url.searchParams.forEach((value, key) => {
    pairs.push([key, value]);
  });
  pairs.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return pairs
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

function canonicalHeaders(headers: Record<string, string>): { canonical: string; signed: string } {
  const entries = Object.entries(headers)
    .map(([k, v]) => [k.toLowerCase(), v.trim().replace(/\s+/g, " ")] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return {
    canonical: `${entries.map(([k, v]) => `${k}:${v}`).join("\n")}\n`,
    signed: entries.map(([k]) => k).join(";"),
  };
}

export function signAwsRequest(input: SignRequest): Record<string, string> {
  const ts = input.timestamp ?? new Date();
  const { amz, date } = amzDate(ts);
  const headers: Record<string, string> = {
    host: input.url.host,
    "x-amz-date": amz,
    ...input.headers,
  };
  if (input.credentials.sessionToken) {
    headers["x-amz-security-token"] = input.credentials.sessionToken;
  }
  const body = input.body ?? "";
  headers["x-amz-content-sha256"] = sha256Hex(body);
  const { canonical, signed } = canonicalHeaders(headers);
  const canonicalRequest = [
    input.method.toUpperCase(),
    input.url.pathname || "/",
    canonicalQuery(input.url),
    canonical,
    signed,
    headers["x-amz-content-sha256"],
  ].join("\n");
  const scope = `${date}/${input.region}/${input.service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amz, scope, sha256Hex(canonicalRequest)].join("\n");
  const kDate = hmac(`AWS4${input.credentials.secretAccessKey}`, date);
  const kRegion = hmac(kDate, input.region);
  const kService = hmac(kRegion, input.service);
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${input.credentials.accessKeyId}/${scope}, SignedHeaders=${signed}, Signature=${signature}`;
  return headers;
}

export async function loadAwsCredentials(env: NodeJS.ProcessEnv = process.env): Promise<AwsCredentials> {
  if (env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY) {
    return {
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
      sessionToken: env.AWS_SESSION_TOKEN,
    };
  }
  const roleArn = env.AWS_ROLE_ARN;
  const tokenFile = env.AWS_WEB_IDENTITY_TOKEN_FILE;
  if (roleArn && tokenFile) {
    return assumeWebIdentity(roleArn, tokenFile, env.AWS_REGION ?? "us-east-1");
  }
  throw new Error("AWS credentials not found (set keys or IRSA web identity)");
}

async function assumeWebIdentity(roleArn: string, tokenFile: string, region: string): Promise<AwsCredentials> {
  const token = (await readFile(tokenFile, "utf8")).trim();
  const endpoint = region.startsWith("cn-")
    ? `https://sts.${region}.amazonaws.com.cn`
    : `https://sts.${region}.amazonaws.com`;
  const body = new URLSearchParams({
    Action: "AssumeRoleWithWebIdentity",
    Version: "2011-06-15",
    RoleArn: roleArn,
    RoleSessionName: "metaprompt-agentcore",
    WebIdentityToken: token,
  }).toString();
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const xml = await res.text();
  if (!res.ok) throw new Error(`STS AssumeRoleWithWebIdentity failed (${res.status})`);
  const accessKeyId = xmlMatch(xml, "AccessKeyId");
  const secretAccessKey = xmlMatch(xml, "SecretAccessKey");
  const sessionToken = xmlMatch(xml, "SessionToken");
  if (!accessKeyId || !secretAccessKey || !sessionToken) {
    throw new Error("STS response missing credentials");
  }
  return { accessKeyId, secretAccessKey, sessionToken };
}

function xmlMatch(xml: string, tag: string): string | undefined {
  const m = xml.match(new RegExp(`<${tag}>([^<]+)</${tag}>`));
  return m?.[1];
}
