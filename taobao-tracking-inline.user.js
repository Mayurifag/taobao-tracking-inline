// ==UserScript==
// @name         Taobao Tracking Inline
// @namespace    https://github.com/mayurifag/taobao-tracking-inline
// @version      0.0.3
// @description  Shows Taobao logistics tracking numbers near orders/items and hides bought-items clutter.
// @match        https://buyertrade.taobao.com/trade/itemlist/list_bought_items.htm*
// @downloadURL  https://raw.githubusercontent.com/Mayurifag/taobao-tracking-inline/master/taobao-tracking-inline.user.js
// @updateURL    https://raw.githubusercontent.com/Mayurifag/taobao-tracking-inline/master/taobao-tracking-inline.user.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const LABEL_CLASS = "tb-logistics-visible-code";
  const STATUS_CLASS = "tb-logistics-status";
  const STYLE_ID = "tb-logistics-inline-style";
  const CARD_CLASS = "tb-logistics-card";
  const CARD_BODY_CLASS = "tb-logistics-card-body";
  const SLOT_SELECTOR = "[data-taobao-logistics-slot=true]";
  const SCRIPT_UI_SELECTOR = `.${LABEL_CLASS}, .${STATUS_CLASS}, ${SLOT_SELECTOR}, [data-taobao-logistics-codes=true]`;
  const CACHE_PREFIX = "taobao-logistics:";
  const REQUEST_DELAY_MIN = 250;
  const REQUEST_DELAY_MAX = 700;
  let queueRunning = false;
  let scanQueued = false;
  let rescanNeeded = false;
  let observer = null;
  let observerStopped = false;
  let sawOrders = false;

  if (window.location.hostname !== "buyertrade.taobao.com") {
    return;
  }

  function delay(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function randomRequestDelay() {
    return delay(REQUEST_DELAY_MIN + Math.random() * (REQUEST_DELAY_MAX - REQUEST_DELAY_MIN));
  }

  function installStyles() {
    if (document.getElementById(STYLE_ID)) {
      return;
    }

    const style = document.createElement("style");

    style.id = STYLE_ID;
    style.textContent = `
      .trade-container-shopOrderContainer [class*="extBlank"],
      .trade-container-shopOrderContainer [class*="extItems"],
      [class*="exportFileTooltips"],
      .ant-tooltip:has([class*="exportFileTooltips"]),
      [class*="exportHighlight"],
      .image-search-context-outTip,
      [class*="recommend--"],
      .tb-picks-container,
      .tb-pick-feeds-container,
      #product-list-container,
      #J_SiteFooter,
      .tb-footer {
        display: none !important;
      }

      .${CARD_CLASS} {
        display: inline-flex;
        box-sizing: border-box;
        max-width: 360px;
        margin-left: 10px;
        padding: 3px 7px;
        border: 1px solid #ffd8bf;
        border-radius: 999px;
        background: #fff7f0;
        color: #d4380d;
        font-size: 12px;
        line-height: 18px;
        vertical-align: middle;
        word-break: break-all;
        user-select: text;
        cursor: text;
        contain: content;
        isolation: isolate;
      }

      .trade-container-orderOperationsCol .${CARD_CLASS} {
        display: flex;
        width: fit-content;
        max-width: 128px;
        margin: 0 auto;
        border-radius: 8px;
        text-align: center;
        overflow-wrap: anywhere;
        word-break: normal;
      }

      .${CARD_BODY_CLASS},
      .${LABEL_CLASS} {
        display: inline;
      }

      .${LABEL_CLASS} {
        color: #d4380d;
        font-weight: 600;
      }
    `;
    document.documentElement.append(style);
  }

  function createLabel(trackingNumber, carrier) {
    const label = document.createElement("span");

    label.className = LABEL_CLASS;
    label.dataset.trackingNumber = trackingNumber;
    label.textContent = carrier ? `${trackingNumber} (${carrier})` : trackingNumber;

    return label;
  }

  function appendLabels(target, trackingNumbers, carrier) {
    const duplicateRoot = target.closest(".trade-container-shopOrderContainer") || target;
    const missing = trackingNumbers.filter(
      (trackingNumber) =>
        !duplicateRoot.querySelector(
          `.${LABEL_CLASS}[data-tracking-number="${CSS.escape(trackingNumber)}"]`,
        ),
    );

    if (!missing.length) {
      return;
    }

    target
      .closest(".trade-container-shopOrderContainer")
      ?.querySelector(`.${STATUS_CLASS}`)
      ?.remove();

    const container = document.createElement("span");
    const body = document.createElement("span");

    container.className = CARD_CLASS;
    container.dataset.taobaoLogisticsCodes = "true";
    body.className = CARD_BODY_CLASS;

    for (const trackingNumber of missing) {
      body.append(createLabel(trackingNumber, carrier));
    }

    container.append(body);
    target.append(container);
  }

  function setStatus(order, message) {
    const target = getOrderLabelTarget(order);
    const existing = order.querySelector(`.${STATUS_CLASS}`);

    if (existing) {
      const body = existing.querySelector(`.${CARD_BODY_CLASS}`);

      if (body && body.textContent !== message) {
        body.textContent = message;
      }

      return;
    }

    const status = document.createElement("span");
    const body = document.createElement("span");

    status.className = `${STATUS_CLASS} ${CARD_CLASS}`;
    body.className = CARD_BODY_CLASS;
    body.textContent = message;
    status.append(body);

    target.append(status);
  }

  function getCachedLogistics(orderId) {
    try {
      const raw = localStorage.getItem(`${CACHE_PREFIX}${orderId}`);

      return raw ? JSON.parse(raw) : null;
    } catch (_error) {
      return null;
    }
  }

  function setCachedLogistics(orderId, data) {
    try {
      localStorage.setItem(
        `${CACHE_PREFIX}${orderId}`,
        JSON.stringify({ ...data, savedAt: Date.now() }),
      );
    } catch (_error) {}
  }

  function getOrderId(order) {
    const idElement = order.querySelector(
      "[id^=orderColContainer_], [id^=orderDetailCol_], [id^=orderOperationsCol_]",
    );
    const id = idElement?.id?.match(/_(\d+)$/)?.[1] || order.id?.match(/_(\d+)$/)?.[1];

    if (id) {
      return id;
    }

    return (order.innerText || order.textContent || "").match(/\b\d{16,}\b/)?.[0];
  }

  function getOrderLabelTarget(order) {
    const existingSlot = order.querySelector(SLOT_SELECTOR);

    if (existingSlot) {
      return existingSlot;
    }

    const orderDate = order.querySelector('[class*="shopInfoOrderTime"]');

    if (orderDate) {
      const slot = document.createElement("span");

      slot.dataset.taobaoLogisticsSlot = "true";
      orderDate.after(slot);

      return slot;
    }

    const orderHeader = order.querySelector("[id^=orderColContainer_]");

    if (orderHeader) {
      return orderHeader;
    }

    return order;
  }

  async function fetchLogistics(orderId) {
    const response = await fetch(`/trade/json/transit_step.do?bizOrderId=${orderId}`, {
      credentials: "include",
    });
    const buffer = await response.arrayBuffer();
    const text = new TextDecoder("gbk").decode(buffer);
    const data = JSON.parse(text);

    if (data.isSuccess !== "true" || !data.expressId) {
      return null;
    }

    return {
      carrier: data.expressName,
      trackingNumbers: [data.expressId],
    };
  }

  function renderData(order, orderId, data) {
    appendLabels(getOrderLabelTarget(order), data.trackingNumbers, data.carrier);
    setCachedLogistics(orderId, { ...data, status: "ok" });
    order.dataset.taobaoLogisticsState = "done";
  }

  function renderNoTracking(order) {
    setStatus(order, "no tracking (unpaid/closed)");
    order.dataset.taobaoLogisticsState = "done";
  }

  function renderRetryable(order, message) {
    setStatus(order, `${message}; will retry on reload`);
    order.dataset.taobaoLogisticsState = "retryable";
  }

  async function processOrder(order) {
    const orderId = getOrderId(order);
    let data = null;

    if (!orderId) {
      return;
    }

    const cached = getCachedLogistics(orderId);

    if (cached?.trackingNumbers?.length) {
      renderData(order, orderId, cached);
      return;
    }

    if (cached?.status === "none") {
      renderNoTracking(order);
      return;
    }

    order.dataset.taobaoLogisticsState = "processing";
    setStatus(order, "loading");

    try {
      await randomRequestDelay();
      data = await fetchLogistics(orderId);
    } catch (_error) {
      renderRetryable(order, "request failed");
      return;
    }

    if (data) {
      renderData(order, orderId, data);
      return;
    }

    renderRetryable(order, "no tracking returned");
  }

  function getUnprocessedOrders() {
    return [...document.querySelectorAll(".trade-container-shopOrderContainer")].filter(
      (order) =>
        order instanceof HTMLElement && !order.dataset.taobaoLogisticsState && getOrderId(order),
    );
  }

  function stopObserverIfDone() {
    if (observerStopped || queueRunning || !sawOrders || getUnprocessedOrders().length) {
      return;
    }

    observer?.disconnect();
    observerStopped = true;
  }

  async function scan() {
    if (queueRunning) {
      rescanNeeded = true;
      return;
    }

    queueRunning = true;
    rescanNeeded = false;

    const orders = getUnprocessedOrders();

    if (orders.length) {
      sawOrders = true;
    }

    for (const order of orders) {
      await processOrder(order);
    }

    queueRunning = false;

    if (rescanNeeded) {
      scheduleScan();
      return;
    }

    stopObserverIfDone();
  }

  function scheduleScan() {
    if (observerStopped || scanQueued) {
      return;
    }

    scanQueued = true;

    const run = () => {
      scanQueued = false;
      scan();
    };

    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(run, { timeout: 1000 });
      return;
    }

    requestAnimationFrame(run);
  }

  installStyles();
  scheduleScan();

  function isIgnoredMutation(mutation) {
    const target = mutation.target;

    if (target instanceof HTMLElement && target.closest(".ant-popover")) {
      return true;
    }

    if (isScriptUiNode(target)) {
      return true;
    }

    const changedNodes = [...mutation.addedNodes, ...mutation.removedNodes];

    return changedNodes.length > 0 && changedNodes.every(isScriptUiNode);
  }

  function isScriptUiNode(node) {
    if (node instanceof HTMLElement) {
      return node.matches(SCRIPT_UI_SELECTOR) || Boolean(node.closest(SCRIPT_UI_SELECTOR));
    }

    return Boolean(node.parentElement?.closest(SCRIPT_UI_SELECTOR));
  }

  observer = new MutationObserver((mutations) => {
    if (mutations.every(isIgnoredMutation)) {
      return;
    }

    scheduleScan();
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
})();
