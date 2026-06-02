# AGENTS.md

- Taobao orders page: `https://buyertrade.taobao.com/trade/itemlist/list_bought_items.htm`.
- Direct logistics endpoint: `/trade/json/transit_step.do?bizOrderId=<orderId>`; response is GBK JSON with `expressId` and `expressName`.
- Tracking results are cached in `localStorage` under `taobao-logistics:<orderId>`.
- Closed/unpaid orders are cached as `status: "none"`; transient request/no-tracking failures must stay uncached so reload retries them.
- Keep request pacing small and randomized to reduce captcha risk.
- Do not rely on visible Chinese labels where avoidable; users may use browser translation.
