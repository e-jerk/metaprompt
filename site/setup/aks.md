# Metaprompt on AKS (stub)

The Helm chart is generic Kubernetes. AKS values (`values-aks.yaml`, Workload Identity, Azure Disk/Files) are **not shipped in v1**.

Use the same chart with your own values:

- ServiceAccount annotations for Azure Workload Identity
- StorageClass for Azure Disk (interactive PVCs) or Azure Files if you switch `storage.mode`

Do not add Azure-specific APIs to the templates. When values ship, this page will match `metaprompt-install-aks`.
