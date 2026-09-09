# Adapter images

Each catalog harness is an image on top of `runner`. Vendor Task / Agent / subagent tools are listed in `disallowedTools` and must stay off. Parallel work is `job.spawn` (a new Job), never an in-container helper.

| Image | Path |
| --- | --- |
| `ghcr.io/e-jerk/metaprompt/mcp` | `adapters/mcp` |
| `ghcr.io/e-jerk/metaprompt/runner` | `adapters/runner` |
| `ghcr.io/e-jerk/metaprompt/stub` | `adapters/stub` |
| `ghcr.io/e-jerk/metaprompt/opencode` | `adapters/opencode` |
| `ghcr.io/e-jerk/metaprompt/claude-code` | `adapters/claude-code` |
| `ghcr.io/e-jerk/metaprompt/codex` | `adapters/codex` |
| `ghcr.io/e-jerk/metaprompt/cursor` | `adapters/cursor` |
| `ghcr.io/e-jerk/metaprompt/session` | `adapters/session` (root exec image: all CLIs) |
| `ghcr.io/e-jerk/metaprompt/runner` | also the `agentcore` harness (InvokeHarness / InvokeAgentRuntime, Memory, plane MCP) |

Runtime is Bun. On Apple Silicon build with `container build` (see `metaprompt-build`); CI uses `docker buildx bake`.
