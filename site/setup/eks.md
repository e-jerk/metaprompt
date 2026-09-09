---
name: metaprompt-install-eks
description: Install Metaprompt onto an existing EKS kubecontext with GitHub Enterprise OIDC, GHCR images, optional Bedrock / AgentCore IRSA. No Clanker Cloud subscription required.
---

# Install Metaprompt on EKS

Bring an EKS kubecontext (eksctl, console, or any provisioner). This skill is Helm + OIDC onto that context. **No Clanker Cloud subscription is required.**

Optional: if you already have the Clanker CLI and want it to create the cluster, see `metaprompt-install-clanker`.

We do not create GitHub Enterprise or Bedrock approvals here.

## Prerequisites

- `kubectl` pointed at the target EKS cluster
- `helm`
- GHCR pull access for `ghcr.io/e-jerk/metaprompt/*`
- GitHub Enterprise OIDC issuer (Cloud or Server)
- Optional: IRSA role for Bedrock InvokeModel (`bedrock:InvokeModel`, `InvokeModelWithResponseStream`, `ListInferenceProfiles`) and/or AgentCore (`bedrock-agentcore:InvokeHarness`, `bedrock-agentcore:InvokeAgentRuntime`, and if Memory is set `bedrock-agentcore:CreateEvent`, `bedrock-agentcore:RetrieveMemoryRecords`) on the **job** service account
- Optional: a plane URL AgentCore can reach (`bedrock.agentcore.planeExternalUrl` — Ingress/NLB or the same VPC). ClusterIP `http://metaprompt-mcp:3333` is only for in-cluster Jobs.

## Values

Edit `deploy/chart/values-eks.yaml`:

```yaml
auth:
  oidc:
    provider: github-enterprise
    issuer: https://ghe.example.com/_services/token
    # Cloud Actions: https://token.actions.githubusercontent.com
    audience: metaprompt
    allowedOrgs: [e-jerk]
```

Humans: a GitHub App or OAuth App that issues OIDC-compatible tokens against that enterprise.
CI: GitHub Actions `id-token: write`. Same verifier; ACL still applies.

This is **user → plane** OIDC. It is not EKS IRSA. Three identities coexist:

1. **Users / CI → plane** — GitHub Enterprise OIDC JWT (`actor` / `sub`)
2. **Jobs → AWS** — IRSA on the **job** service account (Bedrock / AgentCore)
3. **Plane → GitHub and other apps** — GitHub App installation tokens, or RFC 8693 / jwt-bearer exchange of the **mcp** ServiceAccount token (cluster OIDC issuer, or IRSA web identity). Private key: Secret `metaprompt-github-app`. Never mount it on Jobs.

```yaml
auth:
  apps:
    tokenFile: /var/run/secrets/kubernetes.io/serviceaccount/token
    github:
      grant: github-app
      appId: "123456"
      installationId: "789012"
    extras:
      - name: linear
        grant: token-exchange
        tokenUrl: https://sts.example/token
        audience: linear
        allowedGroups: [eng]
```

```bash
kubectl -n metaprompt create secret generic metaprompt-github-app --from-file=private-key=./github-app.pem
```

For `grant: token-exchange` on GitHub, point `tokenUrl` at a broker that trusts the EKS OIDC issuer (octo-sts / github-sts) and omit the App PEM from the cluster if the broker holds it. `gh.*` and `vcs.cred.mint` then use the minted installation token (`x-access-token`). `app.cred.mint` mints other apps. Long-lived PATs are plane-only fallback and are never returned to Jobs.

Optional Bedrock models (Claude Code / OpenCode) and AgentCore (Job harness `agentcore`):

```yaml
bedrock:
  enabled: true
  region: us-east-1
  serviceAccount:
    annotations:
      eks.amazonaws.com/role-arn: arn:aws:iam::ACCOUNT:role/metaprompt-bedrock
  agentcore:
    enabled: true
    harnessArn: arn:aws:bedrock-agentcore:us-east-1:ACCOUNT:harness/NAME-ID
    # or runtimeArn: arn:aws:bedrock-agentcore:us-east-1:ACCOUNT:runtime/RUNTIME_ID
    planeExternalUrl: https://metaprompt.example.com
    memoryArn: arn:aws:bedrock-agentcore:us-east-1:ACCOUNT:memory/NAME-ID
    gatewayUrl: https://GATEWAY_ID.gateway.bedrock-agentcore.us-east-1.amazonaws.com/mcp
    gatewayArn: arn:aws:bedrock-agentcore:us-east-1:ACCOUNT:gateway/NAME-ID
    awsSkillPaths: ["core-skills/*"]
    attachPlaneMcp: true
    enableBrowser: false
    enableCodeInterpreter: false
```

The Job service account needs those AgentCore actions. The plane does not invoke AgentCore; the runner Job does (SigV4 / IRSA). `session.create` with `agentcore` is rejected — use `run.create` / `job.spawn`. Set `planeExternalUrl` so the AWS microVM can call plane MCP (`job.spawn`, `coord.*`, `memory.*`). Same `runtimeSessionId` across attempts; `actorId` is the Metaprompt owner. Gateway URL, when set, is catalog MCP `agentcore-gateway` for any harness. Children still spawn with `job.spawn`. AgentCore filesystem (optional S3 Files / EFS on the AWS harness) is not the Job `/workspace`.

## Commands

```bash
brew tap e-jerk/metaprompt https://github.com/e-jerk/metaprompt
brew install --HEAD metaprompt
# BYO EKS kubecontext. CLI helm/kubectl run in ghcr.io/e-jerk/metaprompt/cli.
# edit a local values-eks.yaml (OIDC issuer, orgs, optional AgentCore)
metaprompt install --values ./values-eks.yaml
# or: metaprompt install eks
# checkout: ./scripts/bootstrap.sh --values deploy/chart/values-eks.yaml
```

No cluster yet? Create one with your usual AWS tools, then re-run install. Local laptop: `metaprompt up`. Clanker CLI is an optional extra, not a requirement.

## Ready checks

```bash
kubectl -n metaprompt rollout status deploy/metaprompt-mcp
kubectl -n metaprompt get deploy,svc,ds
```

## Attach a parent harness

```bash
kubectl -n metaprompt port-forward svc/metaprompt-mcp 3333:3333
```

MCP URL: `http://127.0.0.1:3333/mcp`

Optional laptop-only Clanker MCP (skip unless you already run Clanker; do not pass to Jobs):

```bash
clanker mcp --transport http --listen 127.0.0.1:39393
```

Send `Authorization: Bearer <GitHub Enterprise OIDC JWT>`.
The user is the JWT `actor` (or `sub`). Org/repo/team claims map to groups.

Call `harness.list`, then `run.create`. Spawn subagents only as Jobs (`job.spawn`), never in-container.
