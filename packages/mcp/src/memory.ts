import { createHash } from "node:crypto";
import { newId, type MemoryHit, type MemoryRecord, type MemoryScope } from "@metaprompt/shared";
import { PlaneError } from "./errors.js";

export const HASH_EMBEDDING_DIM = 64;

export type MemoryRow = MemoryRecord & { embedding: number[] };

export type MemorySearchFilter = {
  scope?: MemoryScope;
  owner?: string;
  partyId?: string;
  repo?: string;
  limit: number;
};

export interface Embedder {
  readonly provider: string;
  readonly dim: number;
  embed(text: string): Promise<number[]>;
}

export interface VectorMemoryStore {
  readonly embedder: Embedder;
  put(row: MemoryRow): Promise<void>;
  get(id: string): Promise<MemoryRow | undefined>;
  delete(id: string): Promise<boolean>;
  search(query: number[], filter: MemorySearchFilter): Promise<MemoryHit[]>;
}

const SECRET_PATTERNS: RegExp[] = [
  /-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/,
  /\b(ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{20,})\b/,
  /\bsk-[A-Za-z0-9]{20,}\b/,
  /\b(xox[baprs]-[A-Za-z0-9-]{10,})\b/,
  /Bearer\s+[A-Za-z0-9\-._~+/]+=*/,
  /apiVersion:\s*v1[\s\S]{0,400}kind:\s*Config/,
  /kind:\s*Config[\s\S]{0,400}clusters:/,
];

export function assertNonSecretMemory(text: string): void {
  for (const re of SECRET_PATTERNS) {
    if (re.test(text)) {
      throw new PlaneError(400, "memory text looks like a secret; store non-secret text only");
    }
  }
}

export function tokenize(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function addHash(vec: Float64Array, token: string, dim: number): void {
  const digest = createHash("sha256").update(token).digest();
  const mix = createHash("sha256").update(`#${token}`).digest();
  for (let i = 0; i < dim; i++) {
    const a = digest[i % digest.length]!;
    const b = mix[(i * 3) % mix.length]!;
    vec[i] += a / 127.5 - 1 + (b / 127.5 - 1) * 0.5;
  }
}

function normalize(vec: Float64Array): number[] {
  let sum = 0;
  for (const n of vec) sum += n * n;
  const norm = Math.sqrt(sum) || 1;
  return Array.from(vec, (n) => n / norm);
}

export function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

export class HashEmbedder implements Embedder {
  readonly provider = "hash";
  constructor(readonly dim = HASH_EMBEDDING_DIM) {}

  async embed(text: string): Promise<number[]> {
    const vec = new Float64Array(this.dim);
    const tokens = tokenize(text);
    if (tokens.length === 0) addHash(vec, text, this.dim);
    else for (const token of tokens) addHash(vec, token, this.dim);
    return normalize(vec);
  }
}

export class OpenAIEmbedder implements Embedder {
  readonly provider = "openai";
  constructor(
    readonly dim = 1536,
    private readonly apiKey = process.env.OPENAI_API_KEY ?? "",
    private readonly model = process.env.METAPROMPT_EMBEDDING_MODEL ?? "text-embedding-3-small",
  ) {}

  async embed(text: string): Promise<number[]> {
    if (!this.apiKey) throw new PlaneError(400, "OPENAI_API_KEY required for openai embeddings");
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model: this.model, input: text, dimensions: this.dim }),
    });
    if (!res.ok) throw new PlaneError(502, `openai embeddings failed: ${res.status}`);
    const body = (await res.json()) as { data?: { embedding: number[] }[] };
    const embedding = body.data?.[0]?.embedding;
    if (!embedding) throw new PlaneError(502, "openai embeddings returned no vector");
    return embedding;
  }
}

export class OllamaEmbedder implements Embedder {
  readonly provider = "ollama";
  constructor(
    readonly dim = HASH_EMBEDDING_DIM,
    private readonly base = process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434",
    private readonly model = process.env.METAPROMPT_EMBEDDING_MODEL ?? "nomic-embed-text",
  ) {}

  async embed(text: string): Promise<number[]> {
    const res = await fetch(`${this.base.replace(/\/$/, "")}/api/embeddings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: this.model, prompt: text }),
    });
    if (!res.ok) throw new PlaneError(502, `ollama embeddings failed: ${res.status}`);
    const body = (await res.json()) as { embedding?: number[] };
    if (!body.embedding) throw new PlaneError(502, "ollama embeddings returned no vector");
    return body.embedding;
  }
}

export function createEmbedder(env: NodeJS.ProcessEnv = process.env): Embedder {
  const provider = env.METAPROMPT_EMBEDDING_PROVIDER ?? "hash";
  const dim = Number(env.METAPROMPT_EMBEDDING_DIM ?? HASH_EMBEDDING_DIM);
  if (provider === "openai") return new OpenAIEmbedder(Number(env.METAPROMPT_EMBEDDING_DIM ?? 1536));
  if (provider === "ollama") return new OllamaEmbedder(dim);
  return new HashEmbedder(Number.isFinite(dim) && dim > 0 ? dim : HASH_EMBEDDING_DIM);
}

function matchesFilter(row: MemoryRow, filter: MemorySearchFilter): boolean {
  if (filter.scope && row.scope !== filter.scope) return false;
  if (filter.owner && row.owner !== filter.owner) return false;
  if (filter.partyId && row.partyId !== filter.partyId) return false;
  if (filter.repo && row.repo !== filter.repo) return false;
  return true;
}

function toHit(row: MemoryRow, score: number): MemoryHit {
  return {
    id: row.id,
    scope: row.scope,
    owner: row.owner,
    partyId: row.partyId,
    repo: row.repo,
    text: row.text,
    metadata: row.metadata,
    createdAt: row.createdAt,
    score,
  };
}

export class InMemoryVectorStore implements VectorMemoryStore {
  private readonly rows = new Map<string, MemoryRow>();

  constructor(readonly embedder: Embedder) {}

  async put(row: MemoryRow): Promise<void> {
    this.rows.set(row.id, row);
  }

  async get(id: string): Promise<MemoryRow | undefined> {
    return this.rows.get(id);
  }

  async delete(id: string): Promise<boolean> {
    return this.rows.delete(id);
  }

  async search(query: number[], filter: MemorySearchFilter): Promise<MemoryHit[]> {
    const hits: MemoryHit[] = [];
    for (const row of this.rows.values()) {
      if (!matchesFilter(row, filter)) continue;
      hits.push(toHit(row, cosine(query, row.embedding)));
    }
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, filter.limit);
  }
}

type SqlClient = {
  unsafe(query: string, params?: unknown[]): Promise<Record<string, unknown>[]>;
  close(): Promise<void>;
};

function bunSql(url: string): SqlClient {
  const Ctor = (globalThis as { Bun?: { SQL?: new (url: string) => SqlClient } }).Bun?.SQL;
  if (!Ctor) throw new Error("Bun.SQL is required when DATABASE_URL is set");
  return new Ctor(url);
}

function vectorLiteral(embedding: number[]): string {
  return `[${embedding.map((n) => (Number.isFinite(n) ? n : 0)).join(",")}]`;
}

function rowFromPg(raw: Record<string, unknown>): MemoryRow {
  const embeddingRaw = raw.embedding;
  let embedding: number[] = [];
  if (Array.isArray(embeddingRaw)) embedding = embeddingRaw.map(Number);
  else if (typeof embeddingRaw === "string") {
    embedding = embeddingRaw
      .replace(/^\[/, "")
      .replace(/\]$/, "")
      .split(",")
      .map((n) => Number(n.trim()));
  }
  const created = raw.created_at ?? raw.createdAt;
  const createdAt =
    created instanceof Date
      ? created.getTime()
      : typeof created === "number"
        ? created
        : Date.parse(String(created ?? Date.now()));
  return {
    id: String(raw.id),
    scope: raw.scope as MemoryScope,
    owner: String(raw.owner ?? ""),
    partyId: raw.party_id ? String(raw.party_id) : undefined,
    repo: raw.repo ? String(raw.repo) : undefined,
    text: String(raw.text ?? ""),
    metadata: (raw.metadata as Record<string, unknown> | undefined) ?? undefined,
    embedding,
    createdAt,
  };
}

export class PgVectorStore implements VectorMemoryStore {
  private readonly sql: SqlClient;

  constructor(
    url: string,
    readonly embedder: Embedder,
    sql?: SqlClient,
  ) {
    this.sql = sql ?? bunSql(url);
  }

  async ready(attempts = 30): Promise<void> {
    let last: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        await this.sql.unsafe("SELECT 1");
        await this.ensureSchema();
        return;
      } catch (err) {
        last = err;
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    throw new Error(`postgres not ready: ${last instanceof Error ? last.message : String(last)}`);
  }

  async ensureSchema(): Promise<void> {
    await this.sql.unsafe("CREATE EXTENSION IF NOT EXISTS vector");
    await this.sql.unsafe(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL,
        owner TEXT,
        party_id TEXT,
        repo TEXT,
        text TEXT NOT NULL,
        metadata JSONB,
        embedding vector(${this.embedder.dim}) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await this.sql.unsafe(
      "CREATE INDEX IF NOT EXISTS memories_embedding_idx ON memories USING hnsw (embedding vector_cosine_ops)",
    );
    await this.sql.unsafe("CREATE INDEX IF NOT EXISTS memories_scope_idx ON memories (scope, owner, party_id, repo)");
  }

  async put(row: MemoryRow): Promise<void> {
    await this.sql.unsafe(
      `INSERT INTO memories (id, scope, owner, party_id, repo, text, metadata, embedding, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::vector, to_timestamp($9 / 1000.0))
       ON CONFLICT (id) DO UPDATE SET
         text = EXCLUDED.text,
         metadata = EXCLUDED.metadata,
         embedding = EXCLUDED.embedding`,
      [
        row.id,
        row.scope,
        row.owner,
        row.partyId ?? null,
        row.repo ?? null,
        row.text,
        JSON.stringify(row.metadata ?? {}),
        vectorLiteral(row.embedding),
        row.createdAt,
      ],
    );
  }

  async get(id: string): Promise<MemoryRow | undefined> {
    const rows = await this.sql.unsafe("SELECT * FROM memories WHERE id = $1", [id]);
    return rows[0] ? rowFromPg(rows[0]) : undefined;
  }

  async delete(id: string): Promise<boolean> {
    const rows = await this.sql.unsafe("DELETE FROM memories WHERE id = $1 RETURNING id", [id]);
    return rows.length > 0;
  }

  async search(query: number[], filter: MemorySearchFilter): Promise<MemoryHit[]> {
    const clauses = ["TRUE"];
    const params: unknown[] = [vectorLiteral(query)];
    let i = 2;
    if (filter.scope) {
      clauses.push(`scope = $${i++}`);
      params.push(filter.scope);
    }
    if (filter.owner) {
      clauses.push(`owner = $${i++}`);
      params.push(filter.owner);
    }
    if (filter.partyId) {
      clauses.push(`party_id = $${i++}`);
      params.push(filter.partyId);
    }
    if (filter.repo) {
      clauses.push(`repo = $${i++}`);
      params.push(filter.repo);
    }
    params.push(filter.limit);
    const sql = `
      SELECT id, scope, owner, party_id, repo, text, metadata, embedding, created_at,
             1 - (embedding <=> $1::vector) AS score
      FROM memories
      WHERE ${clauses.join(" AND ")}
      ORDER BY embedding <=> $1::vector
      LIMIT $${i}
    `;
    const rows = await this.sql.unsafe(sql, params);
    return rows.map((raw) => toHit(rowFromPg(raw), Number(raw.score ?? 0)));
  }

  async close(): Promise<void> {
    await this.sql.close();
  }
}

export async function openMemoryStore(env: NodeJS.ProcessEnv = process.env): Promise<VectorMemoryStore> {
  const embedder = createEmbedder(env);
  const url = env.DATABASE_URL;
  if (!url) return new InMemoryVectorStore(embedder);
  const store = new PgVectorStore(url, embedder);
  await store.ready();
  return store;
}

export function newMemoryId(): string {
  return newId("mem");
}
