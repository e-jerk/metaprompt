variable "REGISTRY" {
  default = "ghcr.io/e-jerk/metaprompt"
}

variable "TAGS" {
  default = ["latest"]
  type    = list(string)
}

variable "PLATFORMS" {
  default = ["linux/amd64", "linux/arm64"]
  type    = list(string)
}

group "default" {
  targets = ["mcp", "runner", "stub", "session", "opencode", "claude-code", "codex", "cursor", "cli"]
}

group "core" {
  targets = ["mcp", "runner", "stub", "session", "cli"]
}

target "_common" {
  context   = "."
  platforms = PLATFORMS
}

target "cli" {
  inherits   = ["_common"]
  dockerfile = "adapters/cli/Dockerfile"
  tags       = [for t in TAGS : "${REGISTRY}/cli:${t}"]
}

target "mcp" {
  inherits   = ["_common"]
  dockerfile = "adapters/mcp/Dockerfile"
  tags       = [for t in TAGS : "${REGISTRY}/mcp:${t}"]
}

target "runner" {
  inherits   = ["_common"]
  dockerfile = "adapters/runner/Dockerfile"
  tags       = [for t in TAGS : "${REGISTRY}/runner:${t}"]
}

target "_from_runner" {
  inherits = ["_common"]
  contexts = {
    runner = "target:runner"
  }
}

target "stub" {
  inherits   = ["_from_runner"]
  dockerfile = "adapters/stub/Dockerfile"
  tags       = [for t in TAGS : "${REGISTRY}/stub:${t}"]
}

target "session" {
  inherits   = ["_from_runner"]
  dockerfile = "adapters/session/Dockerfile"
  tags       = [for t in TAGS : "${REGISTRY}/session:${t}"]
}

target "opencode" {
  inherits   = ["_from_runner"]
  dockerfile = "adapters/opencode/Dockerfile"
  tags       = [for t in TAGS : "${REGISTRY}/opencode:${t}"]
}

target "claude-code" {
  inherits   = ["_from_runner"]
  dockerfile = "adapters/claude-code/Dockerfile"
  tags       = [for t in TAGS : "${REGISTRY}/claude-code:${t}"]
}

target "codex" {
  inherits   = ["_from_runner"]
  dockerfile = "adapters/codex/Dockerfile"
  tags       = [for t in TAGS : "${REGISTRY}/codex:${t}"]
}

target "cursor" {
  inherits   = ["_from_runner"]
  dockerfile = "adapters/cursor/Dockerfile"
  tags       = [for t in TAGS : "${REGISTRY}/cursor:${t}"]
}
