variable "REGISTRY" {
  default = "ghcr.io/e-jerk/metaprompt"
}

variable "TAG" {
  default = "latest"
}

group "default" {
  targets = ["mcp", "runner", "stub", "opencode", "claude-code", "codex", "cursor"]
}

target "mcp" {
  context = "."
  dockerfile = "adapters/mcp/Dockerfile"
  platforms = ["linux/amd64", "linux/arm64"]
  tags = ["${REGISTRY}/mcp:${TAG}"]
}

target "runner" {
  context = "."
  dockerfile = "adapters/runner/Dockerfile"
  platforms = ["linux/amd64", "linux/arm64"]
  tags = ["${REGISTRY}/runner:${TAG}"]
}

target "stub" {
  context = "."
  dockerfile = "adapters/stub/Dockerfile"
  contexts = {
    runner = "target:runner"
  }
  platforms = ["linux/amd64", "linux/arm64"]
  tags = ["${REGISTRY}/stub:${TAG}"]
}

target "opencode" {
  context = "."
  dockerfile = "adapters/opencode/Dockerfile"
  contexts = { runner = "target:runner" }
  platforms = ["linux/amd64", "linux/arm64"]
  tags = ["${REGISTRY}/opencode:${TAG}"]
}

target "claude-code" {
  context = "."
  dockerfile = "adapters/claude-code/Dockerfile"
  contexts = { runner = "target:runner" }
  platforms = ["linux/amd64", "linux/arm64"]
  tags = ["${REGISTRY}/claude-code:${TAG}"]
}

target "codex" {
  context = "."
  dockerfile = "adapters/codex/Dockerfile"
  contexts = { runner = "target:runner" }
  platforms = ["linux/amd64", "linux/arm64"]
  tags = ["${REGISTRY}/codex:${TAG}"]
}

target "cursor" {
  context = "."
  dockerfile = "adapters/cursor/Dockerfile"
  contexts = { runner = "target:runner" }
  platforms = ["linux/amd64", "linux/arm64"]
  tags = ["${REGISTRY}/cursor:${TAG}"]
}
