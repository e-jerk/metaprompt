---
name: metaprompt-install-eks
description: Install Metaprompt onto an existing EKS kubecontext with GitHub Enterprise OIDC, GHCR images, optional Bedrock IRSA. No Clanker Cloud subscription required.
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
- Optional: IRSA role for Bedrock (`bedrock:InvokeModel`, `InvokeModelWithResponseStream`, `ListInferenceProfiles`)

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

This is **not** EKS IRSA and **not** Bedrock IRSA. All three can coexist.

Optional Bedrock:

```yaml
bedrock:
  enabled: true
  region: us-east-1
  serviceAccount:
    annotations:
      eks.amazonaws.com/role-arn: arn:aws:iam::ACCOUNT:role/metaprompt-bedrock
```

## Commands

```bash
./scripts/bootstrap.sh --values deploy/chart/values-eks.yaml
```

No cluster yet? Create one with your usual AWS tools, then re-run bootstrap. Local laptop: `make k3s-up`. Clanker CLI is an optional extra, not a requirement.

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
