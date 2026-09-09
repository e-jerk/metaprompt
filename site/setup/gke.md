# Metaprompt on GKE

The Helm chart is generic Kubernetes. Overlay: `deploy/chart/values-gke.yaml` (Workload Identity annotation placeholder, `premium-rwo` / pd-ssd).

**No Clanker subscription required.** Create the GKE cluster with `gcloud` / console, then bootstrap.

- Existing GKE kubecontext:

```bash
# BYO GKE kubecontext. CLI helm/kubectl run in ghcr.io/e-jerk/metaprompt/cli.
metaprompt install gke
# or: metaprompt install --values ./values-gke.yaml
# checkout: ./scripts/bootstrap.sh --values deploy/chart/values-gke.yaml
```

Fill `serviceAccount.annotations` with `iam.gke.io/gcp-service-account` when you have a GCP service account. Do not add GCP-specific APIs to the templates.

Optional: Clanker CLI can create GKE if you already use it ([setup/clanker.md](clanker.md)). Not required.

AKS values are still a stub: [setup/aks.md](aks.md).
