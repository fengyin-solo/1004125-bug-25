.PHONY: install frontend build preview selfcheck docker

install:
	cd frontend && npm ci

frontend:
	cd frontend && npm run dev

build:
	cd frontend && npm run build

preview:
	cd frontend && npm run preview -- --host 0.0.0.0 --port 5173

selfcheck:
	cd frontend && npm run selfcheck

docker:
	docker compose up --build
