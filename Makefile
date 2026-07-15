.PHONY: install setup scrape deploy

DEPLOY_HOST ?= mac-mini
DEPLOY_DIR  ?= ~/youtube-scraper

install:
	npm install

setup: install
	@cp -n config.yaml config.yaml 2>/dev/null || true
	@echo "Edit config.yaml to add your YouTube channels/playlists."

scrape:
	node cli.js scrape

deploy:
	@echo "Deploying to $(DEPLOY_HOST):$(DEPLOY_DIR)..."
	rsync -av --delete \
		--exclude='.git' \
		--exclude='node_modules' \
		--exclude='output' \
		./ $(DEPLOY_HOST):$(DEPLOY_DIR)/
	ssh $(DEPLOY_HOST) "cd $(DEPLOY_DIR) && /opt/homebrew/bin/npm install --production --prefer-offline 2>&1 | tail -3"
	@echo "Deployed."
