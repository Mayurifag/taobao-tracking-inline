# AGENTS.md

- Main source: `taobao-tracking-inline.user.js`.
- Keep userscript `@version` at `0.0.1` unless making an actual release/commit version bump.
- Taobao orders page: `https://buyertrade.taobao.com/trade/itemlist/list_bought_items.htm`.
- Direct logistics endpoint: `/trade/json/transit_step.do?bizOrderId=<orderId>`; response is GBK JSON with `expressId` and `expressName`.
- Tracking results are cached in `localStorage` under `taobao-logistics:<orderId>`.
- Closed/unpaid orders are cached as `status: "none"`; transient request/no-tracking failures must stay uncached so reload retries them.
- Keep request pacing small and randomized to reduce captcha risk.
- Do not rely on visible Chinese labels where avoidable; users may use browser translation.
- Dev browser: `make devtools-browser` launches Helium with remote debugging on port `9222` using `.browser-profile/`.
- Checks: `make ci` runs Prettier check, ESLint, and `node --check`.
