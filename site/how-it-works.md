# How Metaprompt works

A Kubernetes control plane for swappable CLI coding harnesses. The control surface is MCP. A **parent** is whoever called `run.create` (or `session.create`). Every child is a Kubernetes Job — never an in-container Task / Agent / subagent.

- Source: https://github.com/e-jerk/metaprompt
- Images: `ghcr.io/e-jerk/metaprompt/*`
- Runtime: **Bun**, not Node
- Humans: [index.html](index.html) (this text). Agents installing: [implement.md](implement.md).

## How to use it

You do not prompt Metaprompt as a chatbot API. You start a **parent** (session or Job), then that parent calls plane MCP. Independent workers are one `job.spawn`. Adversaries are more workers in the same party with opposite instructions. They share `coord.*` and artifacts. They never use vendor Task / Agent / subagent tools.

Pick harnesses your cluster can run. Local k3s: `opencode` (free Zen models) or `stub`. EKS with Bedrock: `claude-code`. AgentCore enabled: `agentcore` (Job-only). Mix them in one spawn.

### 1. Start a parent

Laptop, after port-forward. Local token shown; on EKS use a GitHub OIDC JWT.

```bash
curl -sS http://127.0.0.1:3333/mcp \
  -H 'Authorization: Bearer alice-token' \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"session.create","arguments":{"repo":"app"}}}'
# attach: metaprompt session
```

Or a one-shot root Job: `run.create` `{ "harness": "opencode", "repo": "app", "prompt": "…" }`. Children still spawn from inside that Job (it has a run token). You cannot call `job.spawn` with only `alice-token`.

### 2. What you type to the parent

The parent already has system text that says to use `job.spawn`. Your prompt should name roles, say they are parallel Jobs, and forbid in-process agents.

```
Ship a login rate limiter on repo app.

Spawn a swarm with job.spawn (one call, several agents). Do not use Task, Agent, or subagent tools.

Roles:
- implementer: write the smallest correct change (jj, no git remotes).
- adversary: try to bypass the limiter; write findings only, do not "help" the implementer.
- tester: add tests that fail on the bypass, then pass on the fix.

They share this party. Each one coord.artifact.put their result (name: impl / adv / test).
Do not wait by pasting logs. Use job.progress, then job.wait.

After all three finish, spawn judge (after: [impl, adv, test]) to keep only what survives the adversary. coord.artifact.put name=verdict.
Then summarize from run.get summaryTree.
```

### 3. Swarm — parallel Jobs

One `job.spawn`. Distinct `id`s. No `after` means they start together (up to `maxParallelPerParent`, default 8). The plane opens a nested party; the parent is an observer.

```json
{
  "name": "job.spawn",
  "arguments": {
    "agents": [
      {
        "id": "auth",
        "harness": "opencode",
        "prompt": "Implement /login rate limiting. Put the patch summary in coord.artifact.put name=auth. Use jj. When done, self.exit with a short summary."
      },
      {
        "id": "docs",
        "harness": "opencode",
        "prompt": "Write the rate-limit docs from the repo as it is now. coord.artifact.put name=docs. Do not wait for auth."
      },
      {
        "id": "bench",
        "harness": "opencode",
        "prompt": "Add a small bench or load script for /login. coord.artifact.put name=bench."
      }
    ]
  }
}
```

Then `job.progress` (heartbeat, not a log dump) and `job.wait`. `run.get` with `summaryTree: true` rolls child summaries up.

### 4. Adversaries that still work together

Same party, opposite goals. They do not merge in-process. The implementer writes; the adversary attacks; a later Job (`after`) is the only one allowed to reconcile. That is how they work together — shared party, artifacts, and a judge — not a group chat inside one pod.

```json
{
  "name": "job.spawn",
  "arguments": {
    "agents": [
      {
        "id": "impl",
        "harness": "opencode",
        "prompt": "You are the implementer. Add login rate limiting. Do not read the adversary. coord.artifact.put name=impl when the change compiles. jj only."
      },
      {
        "id": "adv",
        "harness": "claude-code",
        "model": "bedrock-sonnet",
        "prompt": "You are the adversary. Do not implement the feature. Find bypasses (header spoof, IPv6, burst, bypass paths). coord.artifact.put name=adv a repro list. Be hostile to the design, not to the party."
      },
      {
        "id": "test",
        "harness": "codex",
        "prompt": "You are the tester. Write tests that would catch the bypasses an attacker would try. coord.artifact.put name=test. Do not soften failing tests to make impl look good."
      },
      {
        "id": "judge",
        "harness": "agentcore",
        "after": ["impl", "adv", "test"],
        "prompt": "You are the judge. coord.artifact.get impl, adv, test. job.progress on those runs. Keep only changes that survive the adversary. If adv still wins, spawn nothing else; self.exit with fail and a punch-list. If impl holds, note residual risk. coord.artifact.put name=verdict."
      }
    ]
  }
}
```

`claude-code` + `bedrock-sonnet` needs `bedrock.enabled`. `agentcore` needs AgentCore configured and is Job-only. If those are off, use `opencode` for every role (still four Jobs). Do not collapse them into one prompt.

Optional after spawn: children `coord.post` status; a coordinator `coord.barrier` before the judge reads. `coord.handoff` starts another run in the same party when you want a human-reviewable next step instead of another spawn edge.

### 5. Dependent pipeline (not a swarm)

Use `after: [id]` when B must see A’s result. That is a DAG of Jobs, not parallel work.

```json
{
  "name": "job.spawn",
  "arguments": {
    "agents": [
      { "id": "schema", "harness": "opencode", "prompt": "Add the migration. coord.artifact.put name=schema." },
      { "id": "api", "harness": "opencode", "after": ["schema"], "prompt": "coord.artifact.get schema. Implement the API. coord.artifact.put name=api." },
      { "id": "review", "harness": "opencode", "after": ["api"], "prompt": "Review api vs schema. Do not rewrite unless you find a break. coord.artifact.put name=review." }
    ]
  }
}
```

### Rules that keep swarms honest

- One `job.spawn` for the whole graph. Do not spawn in a loop if the work is independent.
- Give each agent a single job and a named artifact. The adversary must not “help” the implementer.
- Parents tail with `job.progress` / `run.logs`, not by stuffing descendant logs into the next prompt.
- Depth default max is 4; running per user 16. Kill can `cascade`.
- Never pass `clanker` to a Job. Never put tokens on the CR.

## The shape of a run

The plane is an MCP server in the cluster (`deploy/metaprompt-mcp`). It authenticates callers, enforces ACL, writes catalog and party state, and creates Kubernetes objects. Coding work happens in harness pods.

1. A human or parent harness calls `session.create` (interactive root) or `run.create` (one-shot Job).
2. The plane opens a **party** (or joins one), resolves repo / model / skills / MCPs, and mints a **run token**.
3. It applies a `HarnessJob` CR (`metaprompt.io/v1`). Mode `session` → long-running Pod. Mode `job` → `batch/v1` Job.
4. The runner starts a loopback child MCP, materializes prefix files, then execs the vendor CLI or stub.
5. More workers use `job.spawn` — each spawn is another Job, nested in the party, depth + 1. Summaries roll up. Parents tail with `run.logs` / `job.progress`.

Independent work: one `job.spawn` (parallel Jobs). Dependent work: `after: [id]` or `job.wait`.

## Control surface (MCP)

`http://<plane>:3333/mcp`, JSON-RPC `tools/call`, `Authorization: Bearer …`. In-cluster: `http://metaprompt-mcp:3333`. Laptop: port-forward. Ready: `GET /healthz` → `{"ok":true}`.

Always-on Job MCPs: `plane`, `party`, `jj`. `clanker` is parent-only (`PARENT_ONLY_MCPS`). Never pass it to Jobs.

| Group | Tools |
| --- | --- |
| Discover | `harness.list` `harness.get` `model.list` `skill.list` `mcp.list` `repo.list` `asset.list` |
| Party / coord | `party.create` `party.get` `party.list` `party.add` `party.close` `coord.post` `coord.inbox` `coord.wait` `coord.signal` `coord.barrier` `coord.handoff` `coord.members` `coord.artifact.put` `coord.artifact.get` |
| Runs | `run.create` `run.instruct` `run.wait` `run.kill` `run.cancel` `run.logs` `run.result` `run.list` `run.get` `run.share` `run.unshare` |
| Jobs | `job.run` `job.spawn` `job.wait` `job.kill` `job.logs` `job.progress` |
| Self | `self.suspend` `self.exit` |
| Sessions | `session.create` `session.list` `session.get` `session.attach` `session.delete` |
| Cron | `cron.create` `cron.list` `cron.get` `cron.delete` `cron.enable` |
| jj / VCS | `jj.status` `jj.diff` `jj.log` `jj.new` `jj.describe` `jj.squash` `jj.rebase` `jj.bookmark` `jj.git.fetch` `jj.git.push` `vcs.cred.mint` |
| Memory | `memory.put` `memory.search` `memory.get` `memory.delete` |

## Sessions vs Jobs

| | Session | Job |
| --- | --- | --- |
| Create | `session.create` | `run.create` / `job.spawn` |
| Kubernetes | Long-running Pod, `mode: session` | `batch/v1` Job, `mode: job` |
| Default harness | `session` (fat image). Stub rejected. | Catalog harness you pass |
| Attach | `kubectl exec` → `/workspace/.mp/attach` | `run.logs`; process exits and completes |
| Children | Still Jobs via `job.spawn` | Still Jobs via `job.spawn` |

Storage: `tmpfs` or `pvc`. Local smoke prefers tmpfs.

## HarnessJob and the run token

The CR is the launch record (run id, owner, harness, image, repo, model, party, parent/root, depth, skills, MCPs, assets, storage, plane URL). It does **not** carry the run token, `DATABASE_URL`, or VCS PATs.

The run token is Secret `mp-token-<run>` → `METAPROMPT_RUN_TOKEN`. Jobs never get the memory database URL. Helm release/namespace/labels stay `metaprompt`. Do not put `repos` in Helm config without `currentSha`.

## What the runner does in the pod

1. **Child MCP** on `127.0.0.1:3334`. `party` → `/mcp`, `jj` → `/jj`. Proxies party/coord/job/self/`jj.git.fetch`/`push`/`vcs.cred.mint` to the plane. Local `jj.*` in-pod. Memory on the plane.
2. **Workspace pin** (`.metaprompt-pin` + optional git-sync lowerdir at `/repos/<repo>/current`). Local k3s leaves git-sync off.
3. **jj colocate** if installed.
4. **Prefix files** hashed as `prefixHash`.
5. **Spawn the harness**; Job POSTs `/internal/runs/:id/complete` on exit.

Git credential helpers are emptied. Fetch/push uses minted creds.

## Harnesses and models

| Harness | Image | Default model |
| --- | --- | --- |
| `session` | `…/session:latest` | `none` |
| `opencode` | `…/opencode:latest` | `mimo-v2.5-free` |
| `claude-code` | `…/claude-code:latest` | `bedrock-sonnet` (needs Bedrock) |
| `codex` | `…/codex:latest` | `gpt-5` |
| `cursor` | `…/cursor:latest` | `auto` |
| `agentcore` | `…/runner:latest` | `agentcore` (Job-only; needs AgentCore ARN) |
| `stub` | `…/stub:latest` | `none` (Jobs/smoke only) |

Local k3s: Bedrock and AgentCore off. Disallowed tools: Task, Agent, subagent. AgentCore is Job-only: the runner Job calls `InvokeHarness` / `InvokeAgentRuntime` (SigV4 / IRSA) with `actorId` = owner, stable `runtimeSessionId`, W3C `traceparent` / `baggage`, plane MCP at `planeExternalUrl`, optional Gateway / Browser / Code Interpreter / Memory / skills. The agent loop is the AWS microVM. Gateway can appear in the MCP catalog as `agentcore-gateway`. Children still use `job.spawn`.

**Assets** after `asset.list`: `assets: ["eval-set"]`, ACL `readers`, read-only mount (`pvc:`, `hostPath:`, `configMap:`, `secret:`, `emptyDir` / `emptyDir:Memory`).

**Repos** have readers/writers, `currentSha`, `currentGeneration`. Default local repo `app` has a fixture SHA.

## Parties, memory, VCS

A party is the room for a root and descendants. `coord.handoff` creates another run. `job.spawn` may nest a party. Summaries roll up (capped). Kill can cascade. Share is ACL. Swarm and adversary prompt patterns: [How to use it](#how-to-use-it).

Memory (optional Postgres + pgvector) is plane-only. Scopes: `user`, `party`, `repo`. k3s embedding default is `hash`. AgentCore Jobs can also use AgentCore Memory (`memoryArn`, namespace `/actors/{actorId}`) and write the run summary back with `memory.put` on the party.

VCS is jj-first. `jj.git.fetch` / `push` mint via `vcs.cred.mint` (GitHub App / OIDC token when configured; otherwise a placeholder — the long-lived PAT is never given to Jobs). GitHub issues and PRs are plane tools (`gh.issue.*`, `gh.pr.*`).

## Auth

Local k3s: `local-dev-token` (admin), `alice-token`, `bob-token`. EKS/GKE have three identities: (1) **users → plane** GitHub Enterprise OIDC JWT (`actor` / `sub`); (2) **Jobs → AWS** IRSA on the job service account (Bedrock / AgentCore); (3) **plane → GitHub and other apps** GitHub App or EKS ServiceAccount OIDC token exchange (`app.cred.mint`). They coexist. The App private key and workload token stay on the mcp pod, never on Jobs.

## Limits (defaults)

Max depth 4, running per user 16, parallel per parent 8, attempts 8, suspend TTL 86400s, skill/memory 32KiB, summary 2KiB, rollup 8KiB, tail 50/500.

## Install

[setup.md](setup.md). Clanker is optional.

```bash
brew tap e-jerk/metaprompt https://github.com/e-jerk/metaprompt
brew install --HEAD metaprompt
metaprompt up                 # install a local Kubernetes cluster + Helm
# metaprompt install eks      # BYO cluster
metaprompt smoke
metaprompt forward
```

## What it is not

Not a vendor Task runtime. Not `clanker k8s deploy`. Not a Clanker subscription requirement. Not a place for `DATABASE_URL` or tokens on the CR.
