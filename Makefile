.PHONY: build test typecheck k3s-up k3s-down clanker-up clanker-down bootstrap images sync-site smoke cluster-smoke

build:
	bun run build

test:
	bun run test
	bash cli/metaprompt.test.sh

typecheck:
	bun run typecheck

images:
	docker buildx bake

k3s-up:
	bash cli/metaprompt up

k3s-down:
	bash cli/metaprompt down

clanker-up:
	bash scripts/clanker-up.sh

clanker-down:
	bash scripts/clanker-down.sh

bootstrap:
	bash cli/metaprompt install k3s

sync-site:
	bash scripts/sync-site.sh

smoke:
	bash scripts/smoke.sh

cluster-smoke:
	bash cli/metaprompt smoke
