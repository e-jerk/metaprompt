import type { CronSpec, LogLine, Party, Run } from "@metaprompt/shared";

export type Notification = {
  user: string;
  sessionId?: string;
  type: string;
  payload: unknown;
  at: number;
};

export class MemoryStore {
  runs = new Map<string, Run>();
  parties = new Map<string, Party>();
  logs = new Map<string, LogLine[]>();
  crons = new Map<string, CronSpec>();
  waiters = new Map<string, Array<(run: Run) => void>>();
  notifications: Notification[] = [];
  pvcs = new Set<string>();
  minted: Array<{ repo: string; op: string; runId: string; token: string; at: number }> = [];
  followers = new Map<string, Array<{ user: string; sessionId?: string; kind: "log" | "progress" }>>();
}
