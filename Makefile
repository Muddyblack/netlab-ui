# One entry point for the whole repo. Each package keeps its own tooling and config; these targets
# only fan out to them (the same commands CI runs). Run inside `nix develop` for the toolchain.
.PHONY: help install dev test lint format build wheel

help:
	@echo "make install  install backend (editable) and frontend dependencies"
	@echo "make dev      backend (:8000) and frontend (:5173) together; Ctrl-C stops both"
	@echo "make test     backend, monitoring plugin and desktop tests"
	@echo "make lint     ruff (backend, plugin), oxlint (frontend, desktop), format checks"
	@echo "make format   ruff format"
	@echo "make build    typecheck and build the frontend"
	@echo "make wheel    build the PyPI wheel with the UI and plugin bundled in"

install:
	cd backend && pip install -e ".[dev]"
	cd frontend && npm ci
	cd desktop && npm ci

dev:
	trap 'kill 0' EXIT INT TERM; \
	(cd backend && uvicorn netlab_ui.app.main:app --reload --reload-exclude 'tests/*' --timeout-graceful-shutdown 2) & \
	(cd frontend && npm run dev) & \
	wait

test:
	cd backend && pytest
	cd plugins/monitoring && pytest
	cd desktop && npm test

lint:
	cd backend && ruff check && ruff format --check
	cd plugins/monitoring && ruff check && ruff format --check
	cd frontend && npm run lint
	cd desktop && npm run lint

format:
	cd backend && ruff format
	cd plugins/monitoring && ruff format

build:
	cd frontend && npm run build

wheel:
	scripts/build-wheel.sh
