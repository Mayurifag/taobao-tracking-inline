// ==UserScript==
// @name         Taobao Tracking Inline
// @namespace    https://github.com/mayurifag/taobao-tracking-inline
// @version      0.0.2
// @description  Shows Taobao logistics tracking numbers near orders/items and hides noisy non-order clutter.
// @match        https://*.taobao.com/*
// @match        https://*.tmall.com/*
// @downloadURL  https://raw.githubusercontent.com/Mayurifag/taobao-tracking-inline/master/taobao-tracking-inline.user.js
// @updateURL    https://raw.githubusercontent.com/Mayurifag/taobao-tracking-inline/master/taobao-tracking-inline.user.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const LABEL_CLASS = "tb-logistics-visible-code";
  const HIDDEN_CLASS = "tb-logistics-hidden-noise";
  const STATUS_CLASS = "tb-logistics-status";
  const SCRIPT_UI_SELECTOR = `.${LABEL_CLASS}, .${STATUS_CLASS}, [data-taobao-logistics-slot=true], [data-taobao-logistics-codes=true]`;
  const CACHE_PREFIX = "taobao-logistics:";
  const MASKED_USERNAME = "tb********";
  const REQUEST_DELAY_MIN = 250;
  const REQUEST_DELAY_MAX = 700;
  const RETRY_DELAY_MIN = 12000;
  const RETRY_DELAY_MAX = 24000;
  const MAX_RETRIES = 3;
  let queueRunning = false;
  let scanQueued = false;
  let rescanNeeded = false;

  function delay(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function randomRequestDelay() {
    return delay(REQUEST_DELAY_MIN + Math.random() * (REQUEST_DELAY_MAX - REQUEST_DELAY_MIN));
  }

  function randomRetryDelay() {
    return RETRY_DELAY_MIN + Math.random() * (RETRY_DELAY_MAX - RETRY_DELAY_MIN);
  }

  function createLabel(trackingNumber, carrier) {
    const label = document.createElement("span");

    label.className = LABEL_CLASS;
    label.dataset.trackingNumber = trackingNumber;
    label.textContent = carrier ? `${trackingNumber} (${carrier})` : trackingNumber;
    label.style.cssText = [
      "display:inline-block",
      "width:auto",
      "max-width:100%",
      "margin-left:0",
      "padding:0",
      "color:#ff5000",
      "font-size:12px",
      "line-height:16px",
      "word-break:break-all",
      "vertical-align:middle",
    ].join(";");

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
    container.dataset.taobaoLogisticsCodes = "true";
    container.style.cssText = [
      "display:inline-flex",
      "width:auto",
      "max-width:100%",
      "align-items:center",
      "contain:content",
      "isolation:isolate",
      "user-select:text",
      "cursor:text",
    ].join(";");

    for (const trackingNumber of missing) {
      container.append(createLabel(trackingNumber, carrier));
    }

    target.append(container);
  }

  function setStatus(order, message) {
    const target = getOrderLabelTarget(order);
    const existing = order.querySelector(`.${STATUS_CLASS}`);

    if (existing) {
      if (existing.textContent !== message) {
        existing.textContent = message;
      }

      return;
    }

    const status = document.createElement("span");

    status.className = STATUS_CLASS;
    status.textContent = message;
    status.style.cssText = [
      "display:inline-block",
      "width:auto",
      "max-width:100%",
      "margin-left:0",
      "color:#8a6d3b",
      "font-size:12px",
      "line-height:16px",
      "vertical-align:middle",
      "contain:content",
      "isolation:isolate",
      "user-select:text",
      "cursor:text",
    ].join(";");

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

  function setCachedNoTracking(orderId) {
    try {
      localStorage.setItem(
        `${CACHE_PREFIX}${orderId}`,
        JSON.stringify({ status: "none", savedAt: Date.now() }),
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
    const itemActions = order.querySelector("[class*=operate]");

    if (itemActions) {
      let slot = itemActions.querySelector("[data-taobao-logistics-slot=true]");

      if (!slot) {
        slot = document.createElement("span");
        slot.dataset.taobaoLogisticsSlot = "true";
        slot.setAttribute("role", "text");
        slot.style.cssText = [
          "display:inline-flex",
          "width:auto",
          "max-width:280px",
          "margin-left:8px",
          "align-items:center",
          "vertical-align:middle",
          "contain:content",
          "isolation:isolate",
          "user-select:text",
          "cursor:text",
        ].join(";");
        itemActions.append(slot);
      }

      return slot;
    }

    return order.querySelector(".trade-container-orderOperationsCol") || order;
  }

  function canHaveTracking(order) {
    return order.querySelectorAll(".tbpc_boughtlist_orderItem_order_op").length > 2;
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

  function renderNoTracking(order, orderId) {
    setStatus(order, "no tracking (unpaid/closed)");
    setCachedNoTracking(orderId);
    order.dataset.taobaoLogisticsState = "done";
  }

  function retryLater(order, orderId, reason, attempt = 1) {
    const retryDelay = randomRetryDelay();
    let secondsLeft = Math.ceil(retryDelay / 1000);

    order.dataset.taobaoLogisticsState = "retry-scheduled";
    setStatus(order, `${reason}; retry ${attempt}/${MAX_RETRIES} in ${secondsLeft}s`);

    const countdown = window.setInterval(() => {
      secondsLeft -= 1;

      if (secondsLeft <= 0) {
        window.clearInterval(countdown);
        return;
      }

      setStatus(order, `${reason}; retry ${attempt}/${MAX_RETRIES} in ${secondsLeft}s`);
    }, 1000);

    window.setTimeout(async () => {
      window.clearInterval(countdown);
      setStatus(order, `retrying ${attempt}/${MAX_RETRIES}`);

      try {
        await randomRequestDelay();
        const data = await fetchLogistics(orderId);

        if (data) {
          renderData(order, orderId, data);
          return;
        }

        if (attempt < MAX_RETRIES) {
          retryLater(order, orderId, "no tracking returned", attempt + 1);
          return;
        }

        setStatus(order, "no tracking returned; will retry on reload");
        order.dataset.taobaoLogisticsState = "retryable";
        return;
      } catch (_error) {
        if (attempt < MAX_RETRIES) {
          retryLater(order, orderId, "request failed", attempt + 1);
          return;
        }

        setStatus(order, "request failed; will retry on reload");
        order.dataset.taobaoLogisticsState = "retryable";
      }
    }, retryDelay);
  }

  function hideNoise() {
    const blocks = document.querySelectorAll(
      [
        "[class*=extBlank]",
        "[class*=extItems]",
        "[class*=exportFileTooltips]",
        "[class*=guess]",
        "[class*=Guess]",
        "[class*=recommend]",
        "[class*=Recommend]",
        "[class*=promotion]",
        "[class*=Promotion]",
        "[class*=marketing]",
        "[class*=Marketing]",
        "[class*=ad-]",
        "[class*=Ad-]",
        "[class*=advert]",
        "[class*=Advert]",
        "footer",
        "[class*=footer]",
        "[class*=Footer]",
      ].join(","),
    );

    for (const block of blocks) {
      if (block.closest(".ant-popover") || block.classList.contains("ant-popover")) {
        continue;
      }

      const text = block.innerText || block.textContent || "";

      if (block.closest(".trade-container-shopOrderContainer")) {
        if (!text.includes("常买常逛") && !text.includes("推荐常看商品")) {
          continue;
        }
      }

      if (
        text.includes("常买常逛") ||
        text.includes("推荐常看商品") ||
        text.includes("Recently viewed") ||
        text.includes("最近浏览") ||
        text.includes("热销爆款") ||
        text.includes("不感兴趣") ||
        text.includes("Not interested") ||
        text.includes("新增订单导出功能") ||
        text.includes("您可以批量导出订单信息") ||
        text.includes("猜你喜欢") ||
        text.includes("为你推荐") ||
        text.includes("淘宝规则") ||
        text.includes("平台服务协议") ||
        text.includes("关于淘宝") ||
        text.includes("营销中心") ||
        text.includes("© 2003")
      ) {
        block.classList.add(HIDDEN_CLASS);
        block.style.display = "none";
      }
    }
  }

  function maskUsernames() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);

    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.parentElement?.closest(`.${LABEL_CLASS}, .${STATUS_CLASS}`)) {
        continue;
      }

      if (/tb\d{6,}/.test(node.nodeValue)) {
        node.nodeValue = node.nodeValue.replace(/tb\d{6,}/g, MASKED_USERNAME);
      }
    }
  }

  async function processOrder(order) {
    const orderId = getOrderId(order);
    let data = null;

    if (!orderId) {
      order.dataset.taobaoLogisticsState = "skipped";
      setStatus(order, "skipped: no order id found");
      return;
    }

    const cached = getCachedLogistics(orderId);

    if (cached?.trackingNumbers?.length) {
      renderData(order, orderId, cached);
      return;
    }

    if (cached?.status === "none") {
      renderNoTracking(order, orderId);
      return;
    }

    if (!canHaveTracking(order)) {
      renderNoTracking(order, orderId);
      return;
    }

    order.dataset.taobaoLogisticsState = "processing";
    setStatus(order, "loading");

    try {
      await randomRequestDelay();
      data = await fetchLogistics(orderId);
    } catch (_error) {
      retryLater(order, orderId, "request failed");
      return;
    }

    if (data) {
      renderData(order, orderId, data);
      return;
    }

    retryLater(order, orderId, "no tracking returned");
  }

  async function scan() {
    if (queueRunning) {
      rescanNeeded = true;
      return;
    }

    queueRunning = true;
    rescanNeeded = false;

    hideNoise();
    maskUsernames();

    const orders = [...document.querySelectorAll(".trade-container-shopOrderContainer")].filter(
      (order) => order instanceof HTMLElement && !order.dataset.taobaoLogisticsState,
    );

    for (const order of orders) {
      await processOrder(order);
    }

    queueRunning = false;

    if (rescanNeeded) {
      scheduleScan();
    }
  }

  function scheduleScan() {
    if (scanQueued) {
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

  const observer = new MutationObserver((mutations) => {
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
