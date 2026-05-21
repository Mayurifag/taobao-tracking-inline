BROWSER ?= helium-browser
DEBUG_PORT ?= 9222
PROFILE_DIR ?= $(CURDIR)/.browser-profile
TAOBAO_URL ?= https://buyertrade.taobao.com/trade/itemlist/list_bought_items.htm

.PHONY: ci format lint syntax devtools-browser clean-browser-profile

ci: format lint syntax

format:
	npm run format:check

lint:
	npm run lint

syntax:
	npm run syntax

devtools-browser:
	$(BROWSER) --remote-debugging-port=$(DEBUG_PORT) --user-data-dir="$(PROFILE_DIR)" --no-first-run --new-window "$(TAOBAO_URL)"

clean-browser-profile:
	rm -rf "$(PROFILE_DIR)"
