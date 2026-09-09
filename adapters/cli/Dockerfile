# syntax=docker/dockerfile:1
# Helm/kubectl/k3d CLI. Host `metaprompt` wraps this with docker run or Apple container run.
# Cluster is still Kubernetes: `up` installs k3d, or `install` uses a BYO kubecontext.
FROM alpine:3.21
ARG TARGETARCH
ARG HELM_VERSION=3.16.4
ARG KUBECTL_VERSION=1.32.2
ARG K3D_VERSION=5.8.3
RUN apk add --no-cache bash ca-certificates curl docker-cli python3 \
  && curl -fsSL "https://get.helm.sh/helm-v${HELM_VERSION}-linux-${TARGETARCH}.tar.gz" \
    | tar -xz --strip-components=1 -C /usr/local/bin "linux-${TARGETARCH}/helm" \
  && curl -fsSL "https://dl.k8s.io/release/v${KUBECTL_VERSION}/bin/linux/${TARGETARCH}/kubectl" \
    -o /usr/local/bin/kubectl \
  && curl -fsSL "https://github.com/k3d-io/k3d/releases/download/v${K3D_VERSION}/k3d-linux-${TARGETARCH}" \
    -o /usr/local/bin/k3d \
  && chmod +x /usr/local/bin/helm /usr/local/bin/kubectl /usr/local/bin/k3d
COPY cli/metaprompt /usr/local/bin/metaprompt
COPY deploy /opt/metaprompt/deploy
COPY scripts /opt/metaprompt/scripts
COPY k3c.yaml /opt/metaprompt/k3c.yaml
RUN chmod +x /usr/local/bin/metaprompt /opt/metaprompt/scripts/*.sh
ENV METAPROMPT_IN_IMAGE=1
ENV METAPROMPT_HOME=/opt/metaprompt
ENV METAPROMPT_SHARE_DEFAULT=/opt/metaprompt
WORKDIR /opt/metaprompt
ENTRYPOINT ["metaprompt"]
