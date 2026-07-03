.PHONY: install setup scrape

install:
	@command -v yt-dlp >/dev/null 2>&1 || { echo "Installing yt-dlp..."; pip install yt-dlp; }
	@echo "Ready. No npm dependencies needed."

setup: install
	@cp -n config.yaml config.yaml 2>/dev/null || true
	@echo "Edit config.yaml to add your YouTube channels/playlists."

scrape:
	node cli.js scrape
