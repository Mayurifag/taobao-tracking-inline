.PHONY: ci format lint syntax

ci: format lint syntax

format:
	npm run format:check

lint:
	npm run lint

syntax:
	npm run syntax
