.PHONY: build test typecheck k3s-up k3s-down clanker-up clanker-down bootstrap images sync-site smoke cluster-smoke

build:
	bun run build

test:
	bun run test

typecheck:
	bun run typecheck

images:
	docker buildx bake

k3s-up:
	bash scripts/k3s-up.sh

k3s-down:
	bash scripts/k3s-down.sh

clanker-up:
	bash scripts/clanker-up.sh

clanker-down:
	bash scripts/clanker-down.sh

bootstrap:
	bash scripts/bootstrap.sh --values deploy/chart/values-k3s.yaml

sync-site:
	bash scripts/sync-site.sh

smoke:
	bash scripts/smoke.sh

cluster-smoke:
	bash scripts/cluster-smoke.sh
