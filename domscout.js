(function initDOMScout(global) {
  "use strict";

  var TOOL_NAME = "DOMScout";
  var VERSION = "1.8.0";
  var MAX_ANCESTORS = 32;
  var MAX_SELECTOR_MATCHES = 25;
  var MAX_SELECTOR_WALK = 4000;
  var COPY_SEQUENCE_DELAY_MS = 120;
  var HIGHLIGHT_MS = 2500;
  var HIGHLIGHT_FILL = "rgba(176, 64, 255, 0.42)";
  var HIGHLIGHT_OUTLINE = "3px solid rgba(212, 107, 255, 0.95)";
  var MAX_CHILDREN = 10;
  var MAX_DESCENDANTS = 12;
  var MAX_TREEWALK_NODES = 250;
  var DEFAULT_RECEIVER_SEND_URL = "http://127.0.0.1:49341/domscout/report";
  var DEFAULT_RECEIVER_HEALTH_URL = "http://127.0.0.1:49341/domscout/health";
  var RECEIVER_TIMEOUT_MS = 4000;
  var MAX_CSS_RULES_SCANNED = 15000;
  var MAX_MATCHED_CSS_RULES = 60;
  var MAX_CSS_RULES_IN_REPORT = 12;
  var MAX_CSS_VARIABLE_CHAIN = 6;
  var STABLE_DATA_ATTRS = [
    "data-testid",
    "data-test",
    "data-qa",
    "data-cy",
    "data-id",
    "data-name",
    "data-role",
    "data-automation-id",
    "data-automation",
    "data-track"
  ];
  var STABLE_ATTRS = [
    "aria-label",
    "role",
    "name",
    "title",
    "type",
    "placeholder",
    "alt",
    "href",
    "src"
  ];
  var CONTAINER_HINT_PATTERN = /\b(container|wrapper|card|panel|content|body|row|col|item|tile|section|group|list|grid|modal|dialog|sheet|sidebar|nav|toolbar|header|footer|menu|shell|layout)\b/i;
  var STATEFUL_CLASS_PATTERN = /\b(active|selected|open|closed|focus|focused|hover|hovered|disabled|checked|current|expanded|collapsed|visible|hidden|loading|error|success|pressed)\b/i;
  var INLINE_CHILD_TAGS = {
    em: true,
    i: true,
    icon: true,
    path: true,
    small: true,
    span: true,
    strong: true,
    svg: true
  };
  var INTERACTIVE_TAGS = {
    a: true,
    button: true,
    details: true,
    input: true,
    label: true,
    option: true,
    select: true,
    summary: true,
    textarea: true
  };
  var CSS_TRACE_GROUPS = [
    { label: "background", properties: ["background", "background-color", "background-image"] },
    { label: "color", properties: ["color"], inherits: true },
    { label: "font-family", properties: ["font", "font-family"], inherits: true },
    { label: "font-size", properties: ["font", "font-size"], inherits: true },
    { label: "font-weight", properties: ["font", "font-weight"], inherits: true },
    { label: "line-height", properties: ["font", "line-height"], inherits: true },
    { label: "padding", properties: ["padding", "padding-top", "padding-right", "padding-bottom", "padding-left"] },
    { label: "margin", properties: ["margin", "margin-top", "margin-right", "margin-bottom", "margin-left"] },
    { label: "border", properties: ["border", "border-top", "border-right", "border-bottom", "border-left", "border-radius"] },
    { label: "display", properties: ["display"] },
    { label: "position", properties: ["position", "top", "right", "bottom", "left"] },
    { label: "z-index", properties: ["z-index"] },
    { label: "overflow", properties: ["overflow", "overflow-x", "overflow-y"] },
    { label: "opacity", properties: ["opacity"] },
    { label: "pointer-events", properties: ["pointer-events"] },
    { label: "box-shadow", properties: ["box-shadow"] },
    { label: "transform", properties: ["transform"] }
  ];
  var state = {
    lastJson: "",
    lastMarkdown: "",
    lastPauseTimer: null,
    lastCompare: null,
    lastCompareMarkdown: "",
    lastReport: null,
    lastSendResult: null,
    lastTarget: null,
    lastBuiltReports: [],
    lastSelectorMatches: null,
    highlightOverlays: [],
    highlightTimer: null,
    markOrder: [],
    marks: Object.create(null)
  };

  function normalizeWhitespace(value) {
    return String(value == null ? "" : value).replace(/\s+/g, " ").trim();
  }

  function truncate(value, maxLength) {
    var text = normalizeWhitespace(value);
    if (!text) {
      return "";
    }
    if (text.length <= maxLength) {
      return text;
    }
    return text.slice(0, Math.max(0, maxLength - 3)) + "...";
  }

  function unique(values) {
    var seen = Object.create(null);
    var results = [];

    (values || []).forEach(function (value) {
      if (!value) {
        return;
      }

      var key = typeof value === "string" ? value : JSON.stringify(value);
      if (seen[key]) {
        return;
      }

      seen[key] = true;
      results.push(value);
    });

    return results;
  }

  function round(value) {
    return typeof value === "number" && isFinite(value)
      ? Math.round(value * 100) / 100
      : value;
  }

  function lower(value) {
    return String(value || "").toLowerCase();
  }

  function escapeAttributeValue(value) {
    return String(value == null ? "" : value)
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\n/g, "\\A ");
  }

  function escapeCssIdentifier(value) {
    if (global.CSS && typeof global.CSS.escape === "function") {
      return global.CSS.escape(String(value));
    }

    return String(value || "").replace(/[^a-zA-Z0-9_-]/g, function (character) {
      return "\\" + character;
    });
  }

  function escapeMarkdown(value) {
    return String(value == null ? "" : value)
      .replace(/\\/g, "\\\\")
      .replace(/\|/g, "\\|")
      .replace(/`/g, "\\`");
  }

  function formatCode(value, fallback) {
    var text = normalizeWhitespace(value);
    return text ? "`" + escapeMarkdown(text) + "`" : fallback || "`n/a`";
  }

  function yesNo(value) {
    return value ? "yes" : "no";
  }

  function normalizeDelay(value, fallback) {
    var numericValue = Number(value);
    if (!isFinite(numericValue) || numericValue < 0) {
      return fallback;
    }
    return Math.round(numericValue);
  }

  function safeJson(value) {
    try {
      return JSON.stringify(value, null, 2);
    } catch (error) {
      return JSON.stringify({ error: "Unable to serialize report." }, null, 2);
    }
  }

  function safeCount(selector, scope) {
    try {
      return {
        count: scope.querySelectorAll(selector).length,
        error: null
      };
    } catch (error) {
      return {
        count: null,
        error: error && error.message ? error.message : String(error)
      };
    }
  }

  function getReceiverSendUrl() {
    return normalizeWhitespace(global.DOMSCOUT_RECEIVER_URL || DEFAULT_RECEIVER_SEND_URL) || DEFAULT_RECEIVER_SEND_URL;
  }

  function getReceiverHealthUrl() {
    var sendUrl = getReceiverSendUrl();
    if (/\/domscout\/report\/?$/.test(sendUrl)) {
      return sendUrl.replace(/\/domscout\/report\/?$/, "/domscout/health");
    }
    if (/\/report\/?$/.test(sendUrl)) {
      return sendUrl.replace(/\/report\/?$/, "/health");
    }
    return global.DOMSCOUT_RECEIVER_HEALTH_URL || DEFAULT_RECEIVER_HEALTH_URL;
  }

  function cacheGet(cache, key) {
    var index;
    if (!cache) {
      return null;
    }

    if (typeof cache.get === "function") {
      return cache.get(key) || null;
    }

    for (index = 0; index < cache.length; index += 1) {
      if (cache[index].key === key) {
        return cache[index].value;
      }
    }

    return null;
  }

  function cacheSet(cache, key, value) {
    if (!cache) {
      return;
    }

    if (typeof cache.set === "function") {
      cache.set(key, value);
      return;
    }

    cache.push({
      key: key,
      value: value
    });
  }

  function getRootContext(element) {
    if (!element || typeof element.getRootNode !== "function") {
      return {
        hostSelector: null,
        isInsideShadowRoot: false,
        note: null,
        rootType: "document"
      };
    }

    var rootNode = element.getRootNode();
    var isShadow = typeof global.ShadowRoot !== "undefined" && rootNode instanceof global.ShadowRoot;
    var host = isShadow ? rootNode.host : null;

    return {
      hostSelector: host ? buildQuickSelector(host) : null,
      isInsideShadowRoot: isShadow,
      note: isShadow
        ? "Selected element is inside a shadow root. Document-scope selectors and match counts can be misleading because querySelectorAll() cannot cross shadow boundaries."
        : null,
      rootNode: rootNode,
      rootType: isShadow ? "shadow-root" : rootNode === global.document ? "document" : "other"
    };
  }

  function getDevtoolsSelection() {
    return typeof $0 !== "undefined" ? $0 : null;
  }

  function getNamedGlobal(name) {
    var normalizedName = normalizeWhitespace(name);

    if (!normalizedName || normalizedName === "$0") {
      return normalizedName === "$0" ? getDevtoolsSelection() : null;
    }

    try {
      return global[normalizedName] || null;
    } catch (error) {
      return null;
    }
  }

  function parseMatchPick(value) {
    var text;
    var match;

    if (typeof value === "number" && isFinite(value) && value >= 1) {
      return Math.floor(value);
    }

    text = normalizeWhitespace(value);
    match = /^#(\d+)$/.exec(text);
    if (match) {
      return Number(match[1]);
    }

    return null;
  }

  function looksLikeCssSelector(value) {
    var text = normalizeWhitespace(value);
    return /[.#\[\]>+~:,=()]/.test(text) || /\s/.test(text);
  }

  function isNamedGlobalElement(name) {
    var value = getNamedGlobal(name);
    return !!(value && value.nodeType);
  }

  function querySelectorAllSafe(root, selector) {
    try {
      return Array.prototype.slice.call(root.querySelectorAll(selector));
    } catch (error) {
      return {
        error: error && error.message ? error.message : String(error)
      };
    }
  }

  function collectOpenShadowMatches(selector) {
    var matches = [];
    var seen = [];
    var roots = [];
    var inspected = 0;
    var walker;
    var current;
    var found;

    function addMatches(root) {
      var nodes = querySelectorAllSafe(root, selector);
      if (nodes && nodes.error) {
        return nodes;
      }

      (nodes || []).forEach(function (element) {
        if (seen.indexOf(element) !== -1) {
          return;
        }
        seen.push(element);
        matches.push(element);
      });

      return null;
    }

    if (!global.document) {
      return matches;
    }

    found = addMatches(global.document);
    if (found && found.error) {
      return found;
    }

    if (global.document.documentElement && typeof global.document.createTreeWalker === "function") {
      walker = global.document.createTreeWalker(
        global.document.documentElement,
        global.NodeFilter ? global.NodeFilter.SHOW_ELEMENT : 1,
        null
      );
      current = walker.currentNode;

      while (current && inspected < MAX_SELECTOR_WALK) {
        if (current.shadowRoot && roots.indexOf(current.shadowRoot) === -1) {
          roots.push(current.shadowRoot);
          found = addMatches(current.shadowRoot);
          if (found && found.error) {
            return found;
          }
        }
        inspected += 1;
        current = walker.nextNode();
      }
    }

    return matches;
  }

  function scoreSelectorMatch(element) {
    var snapshot = getComputedSnapshot(element);
    var rect = snapshot.rect || getRectSnapshot(element);
    var score = 0;
    var classList = getClassList(element);
    var viewportHeight = global.innerHeight || 0;
    var viewportWidth = global.innerWidth || 0;
    var inViewport =
      rect.width > 0 &&
      rect.height > 0 &&
      rect.bottom > 0 &&
      rect.right > 0 &&
      (!viewportHeight || rect.top < viewportHeight) &&
      (!viewportWidth || rect.left < viewportWidth);

    if (isVisibleElement(element, snapshot)) {
      score += 30;
    }
    if (inViewport) {
      score += 18;
    }
    if (element.isConnected) {
      score += 6;
    }
    if (element.id && isStableId(element.id)) {
      score += 24;
    }
    if (normalizeWhitespace(element.getAttribute("aria-label"))) {
      score += 18;
    }
    if (STABLE_DATA_ATTRS.some(function (name) { return normalizeWhitespace(element.getAttribute(name)); })) {
      score += 20;
    }
    if (classList.some(isMeaningfulClassName)) {
      score += 10;
    }
    if (classList.length && classList.every(isHashLike)) {
      score -= 8;
    }
    if (isClickableElement(element, global.getComputedStyle ? global.getComputedStyle(element) : null)) {
      score += 8;
    }
    if (isLikelyContainer(element).isContainer) {
      score += 4;
    }
    score += Math.min(18, Math.round(((rect.width || 0) * (rect.height || 0)) / 2500));
    if (snapshot.opacity === "0") {
      score -= 14;
    }

    return score;
  }

  function describeSelectorMatch(element, index, query) {
    var snapshot = getComputedSnapshot(element);
    var rect = snapshot.rect || getRectSnapshot(element);

    return {
      connected: !!element.isConnected,
      elementIdentity: buildDevtoolsIdentity(element),
      headline: buildElementHeadline(element),
      index: index,
      label: getBestLabel(element) || null,
      query: query,
      rect: {
        height: rect.height,
        width: rect.width,
        x: rect.x,
        y: rect.y
      },
      selector: buildQuickSelector(element),
      visible: isVisibleElement(element, snapshot)
    };
  }

  function rankSelectorMatches(elements, query) {
    return elements
      .slice()
      .sort(function (left, right) {
        var leftScore = scoreSelectorMatch(left);
        var rightScore = scoreSelectorMatch(right);
        if (rightScore !== leftScore) {
          return rightScore - leftScore;
        }
        return buildQuickSelector(left).length - buildQuickSelector(right).length;
      })
      .slice(0, MAX_SELECTOR_MATCHES)
      .map(function (element, index) {
        var summary = describeSelectorMatch(element, index + 1, query);
        summary.element = element;
        summary.score = scoreSelectorMatch(element);
        return summary;
      });
  }

  function storeSelectorMatches(query, matches, truncated) {
    state.lastSelectorMatches = {
      matches: matches,
      query: query,
      timestamp: new Date().toISOString(),
      truncated: !!truncated
    };
    return state.lastSelectorMatches;
  }

  function printSelectorMatchList(record) {
    console.info(
      "[" +
        TOOL_NAME +
        "] Selector " +
        formatCode(record.query) +
        " matched " +
        record.matches.length +
        " element(s). Most likely is #1. Pick with DOMScout.inspect('#1') or DOMScout.test('#1')."
    );
    record.matches.forEach(function (item) {
      console.log(
        "  #" +
          item.index +
          ". " +
          (item.elementIdentity || item.headline) +
          " | " +
          item.selector +
          " | " +
          (item.visible ? "visible" : "not visible") +
          " | " +
          item.rect.width +
          "x" +
          item.rect.height +
          (item.label ? " | " + item.label : "")
      );
    });
    if (record.truncated) {
      console.info("[" + TOOL_NAME + "] Match list was trimmed to the top " + MAX_SELECTOR_MATCHES + " ranked results.");
    }
  }

  function findSelectorMatches(query) {
    var selector = normalizeWhitespace(query);
    var matches;
    var ranked;
    var retrySelector;

    if (!selector) {
      return {
        error: "No selector was provided."
      };
    }

    matches = collectOpenShadowMatches(selector);
    if (matches && matches.error) {
      return {
        error: "Selector could not be evaluated: " + matches.error
      };
    }

    if (!matches.length && !looksLikeCssSelector(selector)) {
      retrySelector = "." + escapeCssIdentifier(selector);
      matches = collectOpenShadowMatches(retrySelector);
      if (matches && matches.error) {
        return {
          error: "Selector could not be evaluated: " + matches.error
        };
      }
      if (matches.length) {
        selector = retrySelector;
      }
    }

    if (!matches.length) {
      return {
        error:
          "No elements matched " +
          selector +
          ". Document-scope queries cannot cross closed shadow roots, and generated class names may have changed."
      };
    }

    ranked = rankSelectorMatches(matches, selector);
    return storeSelectorMatches(selector, ranked, matches.length > ranked.length);
  }

  function resolveMatchPick(index) {
    var record = state.lastSelectorMatches;
    var match;

    if (!record || !record.matches || !record.matches.length) {
      return {
        error: "No ranked match list is available yet. Run a selector search first, then pick with DOMScout.inspect('#1')."
      };
    }

    match = record.matches.filter(function (item) {
      return item.index === index;
    })[0];

    if (!match) {
      return {
        error: "No #" + index + " in the latest match list. Valid picks are #1 through #" + record.matches.length + "."
      };
    }

    if (!match.element) {
      return {
        error: "Match #" + index + " no longer points at a live element. Run the selector search again."
      };
    }

    return {
      element: match.element,
      note: "Picked #" + index + " from the latest selector match list for " + record.query + "."
    };
  }

  function resolveNodeTarget(target, note) {
    if (!target) {
      return {
        error: "No element was provided. Use the picker first, pass a stored global like temp1, or pass a CSS selector / class name."
      };
    }

    if (target.nodeType === 1) {
      return {
        element: target,
        note: note || null
      };
    }

    if (target.nodeType === 3 && target.parentElement) {
      return {
        element: target.parentElement,
        note: note || "Received a text node, so DOMScout used its parent element instead."
      };
    }

    if (target.ownerElement && target.ownerElement.nodeType === 1) {
      return {
        element: target.ownerElement,
        note: note || "Received a non-element node, so DOMScout used its owner element instead."
      };
    }

    return {
      error: "DOMScout expects an Element, a DevTools-stored DOM node, a CSS selector / class name, or a #N match pick."
    };
  }

  function resolveTarget(candidate, argumentCount) {
    var target = candidate;
    var pickIndex;
    var search;
    var named;

    if (!argumentCount) {
      return resolveNodeTarget(getDevtoolsSelection(), null);
    }

    pickIndex = parseMatchPick(candidate);
    if (pickIndex) {
      return resolveMatchPick(pickIndex);
    }

    if (typeof candidate === "string") {
      if (normalizeWhitespace(candidate) === "$0") {
        return resolveNodeTarget(getDevtoolsSelection(), null);
      }

      if (isNamedGlobalElement(candidate) && !looksLikeCssSelector(candidate)) {
        named = getNamedGlobal(candidate);
        return resolveNodeTarget(named, null);
      }

      search = findSelectorMatches(candidate);
      if (search.error) {
        return search;
      }

      if (search.matches.length === 1) {
        return {
          element: search.matches[0].element,
          note: "Selector " + search.query + " matched exactly 1 element."
        };
      }

      return {
        matches: search
      };
    }

    return resolveNodeTarget(target, null);
  }

  function getClassList(element) {
    return Array.prototype.slice.call(element.classList || []);
  }

  function isHashLike(value) {
    var text = String(value || "");
    if (text.length < 6) {
      return false;
    }

    if (/^[a-f0-9]{6,}$/i.test(text)) {
      return true;
    }

    if (/[-_][a-f0-9]{5,}$/i.test(text)) {
      return true;
    }

    if (/__[A-Za-z0-9-]+___[A-Za-z0-9-]{5,}$/.test(text)) {
      return true;
    }

    if (/^[A-Za-z0-9_-]*[a-f0-9]{7,}[A-Za-z0-9_-]*$/.test(text) && !/[aeiou]/i.test(text)) {
      return true;
    }

    if (/[A-Z]/.test(text) && /\d/.test(text) && text.length >= 12 && !/[aeiou]/i.test(text)) {
      return true;
    }

    return false;
  }

  function isStableId(id) {
    var text = String(id || "");
    if (!text || /^\d+$/.test(text)) {
      return false;
    }

    if (/^:r/i.test(text)) {
      return false;
    }

    return !isHashLike(text);
  }

  function isMeaningfulClassName(className) {
    var text = String(className || "");
    if (!text || text.length < 2) {
      return false;
    }

    if (isHashLike(text) || STATEFUL_CLASS_PATTERN.test(text)) {
      return false;
    }

    return /[a-z]{2,}/i.test(text);
  }

  function collectAttributes(element) {
    var attributes = {};
    var aria = {};
    var data = {};

    Array.prototype.forEach.call(element.attributes || [], function (attribute) {
      attributes[attribute.name] = attribute.value;

      if (attribute.name.indexOf("data-") === 0) {
        data[attribute.name] = attribute.value;
      }

      if (attribute.name.indexOf("aria-") === 0) {
        aria[attribute.name] = attribute.value;
      }
    });

    return {
      all: attributes,
      aria: aria,
      data: data
    };
  }

  function summarizeAttributes(attributes, limit) {
    return Object.keys(attributes || {})
      .slice(0, limit || 6)
      .map(function (name) {
        return name + '="' + truncate(attributes[name], 80) + '"';
      });
  }

  function getVisibleTextSummary(element) {
    var text = "";

    try {
      text = normalizeWhitespace(element.innerText || element.textContent || "");
    } catch (error) {
      text = normalizeWhitespace(element.textContent || "");
    }

    return truncate(text, 220);
  }

  function getOuterHtmlExcerpt(element) {
    try {
      return truncate(normalizeWhitespace(element.outerHTML || ""), 520);
    } catch (error) {
      return "";
    }
  }

  function getRectSnapshot(element) {
    var rect = element.getBoundingClientRect();
    return {
      bottom: round(rect.bottom),
      height: round(rect.height),
      left: round(rect.left),
      right: round(rect.right),
      top: round(rect.top),
      width: round(rect.width),
      x: round(rect.x),
      y: round(rect.y)
    };
  }

  function getComputedValue(computed, propertyName, camelName) {
    var value = "";

    if (!computed) {
      return "";
    }

    try {
      if (typeof computed.getPropertyValue === "function") {
        value = computed.getPropertyValue(propertyName);
      }
    } catch (error) {
      value = "";
    }

    if (!normalizeWhitespace(value) && camelName) {
      value = computed[camelName] || "";
    }

    return truncate(value, 180);
  }

  function isIdentityTransform(value) {
    var normalized = normalizeWhitespace(value).replace(/\s+/g, "");
    return (
      normalized === "matrix(1,0,0,1,0,0)" ||
      normalized === "matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1)"
    );
  }

  function isIdentityIndividualTransform(propertyName, value) {
    var normalized = lower(normalizeWhitespace(value)).replace(/\s+/g, " ");

    if (!normalized || normalized === "none") {
      return true;
    }
    if (propertyName === "translate") {
      return /^(0|0px|0%)($| (0|0px|0%)( (0|0px))?$)/.test(normalized);
    }
    if (propertyName === "rotate") {
      return /^(0|0deg|0rad|0grad|0turn)$/.test(normalized);
    }
    if (propertyName === "scale") {
      return /^1($| 1( 1)?$)/.test(normalized);
    }
    return false;
  }

  function normalizeTimingValue(value) {
    if (typeof value === "number") {
      return isFinite(value) ? round(value) : String(value);
    }
    if (value == null || typeof value === "string" || typeof value === "boolean") {
      return value;
    }
    return normalizeWhitespace(value);
  }

  function snapshotTiming(timing, computed) {
    var source = timing || {};
    var result = {};
    var properties = computed
      ? [
          "activeDuration",
          "currentIteration",
          "delay",
          "direction",
          "duration",
          "easing",
          "endDelay",
          "endTime",
          "fill",
          "iterationStart",
          "iterations",
          "localTime",
          "progress"
        ]
      : ["delay", "direction", "duration", "easing", "endDelay", "fill", "iterationStart", "iterations"];

    properties.forEach(function (propertyName) {
      if (typeof source[propertyName] !== "undefined") {
        result[propertyName] = normalizeTimingValue(source[propertyName]);
      }
    });

    return result;
  }

  function getAnimationType(animation) {
    if (typeof global.CSSAnimation === "function" && animation instanceof global.CSSAnimation) {
      return "CSSAnimation";
    }
    if (typeof global.CSSTransition === "function" && animation instanceof global.CSSTransition) {
      return "CSSTransition";
    }
    if (animation && animation.constructor && animation.constructor.name) {
      return animation.constructor.name;
    }
    return "Animation";
  }

  function collectAnimations(element) {
    var animations;

    // getAnimations() covers CSS Animations, CSS Transitions, and Web Animations targeting this element.
    // https://developer.mozilla.org/en-US/docs/Web/API/Element/getAnimations
    if (!element || typeof element.getAnimations !== "function") {
      return {
        available: false,
        error: null,
        items: []
      };
    }

    try {
      animations = element.getAnimations();
    } catch (error) {
      return {
        available: true,
        error: error && error.message ? error.message : String(error),
        items: []
      };
    }

    return {
      available: true,
      error: null,
      items: animations.map(function (animation) {
        var effect = animation.effect || null;
        var timing = null;
        var computedTiming = null;
        var playState = animation.playState || "unknown";

        try {
          timing = effect && typeof effect.getTiming === "function" ? effect.getTiming() : null;
        } catch (error) {
          timing = null;
        }

        try {
          // Computed timing resolves values such as fill and duration while retaining progress details.
          // https://developer.mozilla.org/en-US/docs/Web/API/AnimationEffect/getComputedTiming
          computedTiming =
            effect && typeof effect.getComputedTiming === "function" ? effect.getComputedTiming() : null;
        } catch (error) {
          computedTiming = null;
        }

        var fill =
          (computedTiming && computedTiming.fill) ||
          (timing && timing.fill) ||
          null;
        var type = getAnimationType(animation);
        var name =
          animation.animationName ||
          animation.transitionProperty ||
          animation.id ||
          null;
        var isFinished = playState === "finished";

        return {
          computedTiming: snapshotTiming(computedTiming, true),
          fill: fill,
          finished: isFinished,
          finishedWithFillEffect: isFinished && (fill === "forwards" || fill === "both"),
          id: animation.id || null,
          name: name,
          pending: !!animation.pending,
          playState: playState,
          pseudoElement: effect && effect.pseudoElement ? effect.pseudoElement : null,
          startTime: normalizeTimingValue(animation.startTime),
          currentTime: normalizeTimingValue(animation.currentTime),
          timelineType:
            animation.timeline && animation.timeline.constructor && animation.timeline.constructor.name
              ? animation.timeline.constructor.name
              : null,
          timing: snapshotTiming(timing, false),
          type: type
        };
      })
    };
  }

  function getEffectSnapshot(element, computedStyle) {
    var computed = computedStyle || (global.getComputedStyle ? global.getComputedStyle(element) : null);
    var transform = getComputedValue(computed, "transform", "transform");
    var translate = getComputedValue(computed, "translate", "translate");
    var rotate = getComputedValue(computed, "rotate", "rotate");
    var scale = getComputedValue(computed, "scale", "scale");
    var backdropFilter = getComputedValue(computed, "backdrop-filter", "backdropFilter");
    var webkitBackdropFilter = getComputedValue(
      computed,
      "-webkit-backdrop-filter",
      "webkitBackdropFilter"
    );
    var hasTransformProperty = !!transform && transform !== "none";
    var hasIndividualTransform =
      isNonDefaultEffectValue(translate, ["none"]) ||
      isNonDefaultEffectValue(rotate, ["none"]) ||
      isNonDefaultEffectValue(scale, ["none"]);
    var hasTransform = hasTransformProperty || hasIndividualTransform;
    var individualTransformIsIdentity =
      (!isNonDefaultEffectValue(translate, ["none"]) || isIdentityIndividualTransform("translate", translate)) &&
      (!isNonDefaultEffectValue(rotate, ["none"]) || isIdentityIndividualTransform("rotate", rotate)) &&
      (!isNonDefaultEffectValue(scale, ["none"]) || isIdentityIndividualTransform("scale", scale));
    var dataSticky = element.hasAttribute("data-sticky") ? element.getAttribute("data-sticky") : null;
    var position = getComputedValue(computed, "position", "position");

    return {
      animation: {
        delay: getComputedValue(computed, "animation-delay", "animationDelay"),
        duration: getComputedValue(computed, "animation-duration", "animationDuration"),
        fillMode: getComputedValue(computed, "animation-fill-mode", "animationFillMode"),
        name: getComputedValue(computed, "animation-name", "animationName"),
        playState: getComputedValue(computed, "animation-play-state", "animationPlayState"),
        timingFunction: getComputedValue(
          computed,
          "animation-timing-function",
          "animationTimingFunction"
        )
      },
      animations: collectAnimations(element),
      backdropFilter: backdropFilter || webkitBackdropFilter,
      contain: getComputedValue(computed, "contain", "contain"),
      dataSticky: dataSticky,
      filter: getComputedValue(computed, "filter", "filter"),
      hasIndividualTransform: hasIndividualTransform,
      hasTransform: hasTransform,
      isolation: getComputedValue(computed, "isolation", "isolation"),
      isSticky: position === "sticky",
      mixBlendMode: getComputedValue(computed, "mix-blend-mode", "mixBlendMode"),
      opacity: getComputedValue(computed, "opacity", "opacity"),
      overflow: {
        all: getComputedValue(computed, "overflow", "overflow"),
        x: getComputedValue(computed, "overflow-x", "overflowX"),
        y: getComputedValue(computed, "overflow-y", "overflowY")
      },
      position: position,
      rotate: rotate,
      scale: scale,
      stickyLike: position === "sticky" || dataSticky !== null,
      transform: transform,
      transformIsIdentityMatrix: hasTransformProperty && isIdentityTransform(transform),
      transformState: !hasTransform
        ? "none"
        : hasTransformProperty && isIdentityTransform(transform) && individualTransformIsIdentity
          ? "identity-matrix (still creates a transformed context)"
          : !hasTransformProperty && individualTransformIsIdentity
            ? "identity individual transform (still creates a transformed context)"
          : "transformed",
      transition: {
        duration: getComputedValue(computed, "transition-duration", "transitionDuration"),
        property: getComputedValue(computed, "transition-property", "transitionProperty")
      },
      translate: translate,
      webkitBackdropFilter: webkitBackdropFilter,
      willChange: getComputedValue(computed, "will-change", "willChange"),
      zIndex: getComputedValue(computed, "z-index", "zIndex")
    };
  }

  function getComputedSnapshot(element) {
    var computed = global.getComputedStyle ? global.getComputedStyle(element) : null;
    var rect = getRectSnapshot(element);
    var effects = getEffectSnapshot(element, computed);

    return {
      animation: effects.animation,
      animations: effects.animations,
      backdropFilter: effects.backdropFilter,
      background: computed ? truncate(computed.background || computed.backgroundColor || "", 140) : "",
      border: computed ? truncate(computed.border || "", 140) : "",
      borderRadius: computed ? computed.borderRadius : "",
      boxShadow: computed ? truncate(computed.boxShadow || "", 140) : "",
      color: computed ? computed.color : "",
      contain: effects.contain,
      dataSticky: effects.dataSticky,
      display: computed ? computed.display : "",
      effects: effects,
      filter: effects.filter,
      font: computed
        ? {
            family: computed.fontFamily,
            lineHeight: computed.lineHeight,
            size: computed.fontSize,
            style: computed.fontStyle,
            weight: computed.fontWeight
          }
        : null,
      isolation: effects.isolation,
      isSticky: effects.isSticky,
      margin: computed ? computed.margin : "",
      mixBlendMode: effects.mixBlendMode,
      opacity: computed ? computed.opacity : "",
      overflow: computed
        ? {
            all: computed.overflow,
            x: computed.overflowX,
            y: computed.overflowY
          }
        : null,
      padding: computed ? computed.padding : "",
      pointerEvents: computed ? computed.pointerEvents : "",
      position: computed ? computed.position : "",
      rect: rect,
      rotate: effects.rotate,
      scale: effects.scale,
      transform: computed ? truncate(computed.transform || "", 140) : "",
      transformIsIdentityMatrix: effects.transformIsIdentityMatrix,
      transformState: effects.transformState,
      transition: effects.transition,
      translate: effects.translate,
      visibility: computed ? computed.visibility : "",
      webkitBackdropFilter: effects.webkitBackdropFilter,
      willChange: effects.willChange,
      zIndex: computed ? computed.zIndex : ""
    };
  }

  function isVisibleElement(element, snapshot) {
    var computed = snapshot || getComputedSnapshot(element);
    var rect = computed.rect;
    var styleVisible = computed.display !== "none" && computed.visibility !== "hidden" && computed.visibility !== "collapse";
    var opacityVisible = computed.opacity === "" || Number(computed.opacity) > 0;
    var rectVisible = rect.width > 0 && rect.height > 0;

    return styleVisible && opacityVisible && rectVisible && !element.hidden;
  }

  function isFocusableElement(element) {
    var tagName = lower(element.tagName);
    var tabIndex = element.getAttribute("tabindex");

    if (element.isContentEditable) {
      return true;
    }

    if (tabIndex != null && tabIndex !== "" && Number(tabIndex) >= 0) {
      return true;
    }

    if (tagName === "a" && element.hasAttribute("href")) {
      return true;
    }

    return !!INTERACTIVE_TAGS[tagName];
  }

  function isClickableElement(element, computed) {
    var tagName = lower(element.tagName);
    var role = lower(element.getAttribute("role"));
    var style = computed || (global.getComputedStyle ? global.getComputedStyle(element) : null);
    var cursor = style ? style.cursor : "";

    if (INTERACTIVE_TAGS[tagName]) {
      return true;
    }

    if (/button|link|menuitem|option|radio|switch|tab|checkbox/.test(role)) {
      return true;
    }

    if (typeof element.onclick === "function" || element.hasAttribute("onclick")) {
      return true;
    }

    return cursor === "pointer";
  }

  function getBestLabel(element) {
    var parts = [
      element.getAttribute("aria-label"),
      element.getAttribute("title"),
      element.getAttribute("name"),
      element.getAttribute("alt"),
      getVisibleTextSummary(element),
      isStableId(element.id) ? element.id : ""
    ];

    for (var index = 0; index < parts.length; index += 1) {
      if (normalizeWhitespace(parts[index])) {
        return truncate(parts[index], 100);
      }
    }

    var meaningfulClasses = getClassList(element).filter(isMeaningfulClassName);
    return meaningfulClasses.length ? meaningfulClasses.slice(0, 2).join(" ") : "";
  }

  function buildElementHeadline(element) {
    var tagName = lower(element.tagName);
    var parts = [tagName];
    var classes = getClassList(element).filter(isMeaningfulClassName).slice(0, 2);

    if (element.id) {
      parts.push("#" + element.id);
    }

    if (classes.length) {
      parts.push("." + classes.join("."));
    }

    return parts.join("");
  }

  function buildDevtoolsIdentity(element) {
    var identity = lower(element.tagName);
    var classList = getClassList(element);

    if (element.id) {
      identity += "#" + escapeCssIdentifier(element.id);
    }

    classList.forEach(function (className) {
      if (!className) {
        return;
      }
      identity += "." + escapeCssIdentifier(className);
    });

    return identity;
  }

  function getNthOfTypeIndex(element) {
    var count = 1;
    var sibling = element;

    while ((sibling = sibling.previousElementSibling)) {
      if (sibling.tagName === element.tagName) {
        count += 1;
      }
    }

    return count;
  }

  function hasSameTagSiblings(element) {
    var sibling = element.previousElementSibling;
    while (sibling) {
      if (sibling.tagName === element.tagName) {
        return true;
      }

      sibling = sibling.previousElementSibling;
    }

    sibling = element.nextElementSibling;
    while (sibling) {
      if (sibling.tagName === element.tagName) {
        return true;
      }

      sibling = sibling.nextElementSibling;
    }

    return false;
  }

  function buildTagSegment(element) {
    var tagName = lower(element.tagName);

    if (element.id && isStableId(element.id)) {
      return tagName + "#" + escapeCssIdentifier(element.id);
    }

    var stableClasses = getClassList(element).filter(isMeaningfulClassName).slice(0, 2);
    if (stableClasses.length) {
      return tagName + "." + stableClasses.map(escapeCssIdentifier).join(".");
    }

    if (hasSameTagSiblings(element)) {
      return tagName + ":nth-of-type(" + getNthOfTypeIndex(element) + ")";
    }

    return tagName;
  }

  function buildDomPathSelector(element) {
    var segments = [];
    var current = element;

    while (current && current.nodeType === 1) {
      segments.unshift(buildTagSegment(current));
      if (current.id && isStableId(current.id)) {
        break;
      }
      current = current.parentElement;
    }

    return segments.join(" > ");
  }

  function buildQuickSelector(element) {
    var tagName = lower(element.tagName);
    var attributeName;
    var classList;
    var index;
    var value;

    if (element.id && isStableId(element.id)) {
      return "#" + escapeCssIdentifier(element.id);
    }

    for (index = 0; index < STABLE_DATA_ATTRS.length; index += 1) {
      attributeName = STABLE_DATA_ATTRS[index];
      value = element.getAttribute(attributeName);
      if (normalizeWhitespace(value)) {
        return tagName + "[" + attributeName + '="' + escapeAttributeValue(value) + '"]';
      }
    }

    value = element.getAttribute("aria-label");
    if (normalizeWhitespace(value)) {
      return tagName + '[aria-label="' + escapeAttributeValue(value) + '"]';
    }

    classList = getClassList(element).filter(isMeaningfulClassName).slice(0, 2);
    if (classList.length) {
      return tagName + "." + classList.map(escapeCssIdentifier).join(".");
    }

    return buildTagSegment(element);
  }

  function getUsefulAttributeSelectors(element) {
    var selectors = [];
    var tagName = lower(element.tagName);
    var attributes = collectAttributes(element);
    var key;
    var value;

    STABLE_DATA_ATTRS.forEach(function (name) {
      value = element.getAttribute(name);
      if (normalizeWhitespace(value)) {
        selectors.push({
          baseScore: /test|qa|cy/.test(name) ? 92 : 84,
          kind: "attribute",
          reasons: [name + " looks like a stable data attribute."],
          selector: tagName + "[" + name + '="' + escapeAttributeValue(value) + '"]'
        });
      }
    });

    if (normalizeWhitespace(element.getAttribute("aria-label"))) {
      selectors.push({
        baseScore: 82,
        kind: "attribute",
        reasons: ["aria-label provides a user-facing label."],
        selector: tagName + '[aria-label="' + escapeAttributeValue(element.getAttribute("aria-label")) + '"]'
      });
    }

    if (normalizeWhitespace(element.getAttribute("role")) && normalizeWhitespace(element.getAttribute("aria-label"))) {
      selectors.push({
        baseScore: 88,
        kind: "attribute",
        reasons: ["role + aria-label can be a stable semantic selector."],
        selector:
          '[role="' +
          escapeAttributeValue(element.getAttribute("role")) +
          '"][aria-label="' +
          escapeAttributeValue(element.getAttribute("aria-label")) +
          '"]'
      });
    }

    if (normalizeWhitespace(element.getAttribute("name"))) {
      var nameSelector = tagName + '[name="' + escapeAttributeValue(element.getAttribute("name")) + '"]';
      var typeValue = element.getAttribute("type");
      if (normalizeWhitespace(typeValue)) {
        nameSelector += '[type="' + escapeAttributeValue(typeValue) + '"]';
      }

      selectors.push({
        baseScore: 80,
        kind: "attribute",
        reasons: ["name is often stable on forms and controls."],
        selector: nameSelector
      });
    }

    ["title", "href", "src", "alt", "placeholder"].forEach(function (name) {
      value = element.getAttribute(name);
      if (normalizeWhitespace(value)) {
        selectors.push({
          baseScore: name === "href" || name === "src" ? 72 : 68,
          kind: "attribute",
          reasons: [name + " is present and readable."],
          selector: tagName + "[" + name + '="' + escapeAttributeValue(value) + '"]'
        });
      }
    });

    Object.keys(attributes.data || {}).forEach(function (name) {
      if (STABLE_DATA_ATTRS.indexOf(name) !== -1) {
        return;
      }

      var attrValue = attributes.data[name];
      if (!normalizeWhitespace(attrValue)) {
        return;
      }

      selectors.push({
        baseScore: 76,
        kind: "attribute",
        reasons: [name + " may be stable enough to anchor this element."],
        selector: tagName + "[" + name + '="' + escapeAttributeValue(attrValue) + '"]'
      });
    });

    Object.keys(attributes.aria || {}).forEach(function (name) {
      if (name === "aria-label" || !normalizeWhitespace(attributes.aria[name])) {
        return;
      }

      selectors.push({
        baseScore: 70,
        kind: "attribute",
        reasons: [name + " adds semantic context."],
        selector: tagName + "[" + name + '="' + escapeAttributeValue(attributes.aria[name]) + '"]'
      });
    });

    for (key = 0; key < selectors.length; key += 1) {
      selectors[key].usesAutoGeneratedClass = false;
      selectors[key].usesNth = false;
    }

    return selectors;
  }

  function getClassSelectors(element) {
    var selectors = [];
    var tagName = lower(element.tagName);
    var classList = getClassList(element);
    var meaningful = classList.filter(isMeaningfulClassName);
    var hashLike = classList.filter(isHashLike);
    var index;

    meaningful.slice(0, 3).forEach(function (className) {
      selectors.push({
        baseScore: 66,
        kind: "class",
        reasons: ["Class name looks readable and potentially stable."],
        selector: tagName + "." + escapeCssIdentifier(className),
        usesAutoGeneratedClass: false,
        usesNth: false
      });
    });

    if (meaningful.length >= 2) {
      selectors.push({
        baseScore: 72,
        kind: "class",
        reasons: ["Combining meaningful classes narrows the target."],
        selector:
          tagName +
          "." +
          escapeCssIdentifier(meaningful[0]) +
          "." +
          escapeCssIdentifier(meaningful[1]),
        usesAutoGeneratedClass: false,
        usesNth: false
      });
    }

    if (!meaningful.length && hashLike.length) {
      for (index = 0; index < Math.min(hashLike.length, 2); index += 1) {
        selectors.push({
          baseScore: 42,
          kind: "class",
          reasons: ["Class is available, but it looks generated or unstable."],
          selector: tagName + "." + escapeCssIdentifier(hashLike[index]),
          usesAutoGeneratedClass: true,
          usesNth: false
        });
      }
    }

    return selectors;
  }

  function getParentChildSelectors(element) {
    var selectors = [];
    var childBase = buildTagSegment(element);
    var parent = element.parentElement;
    var ancestor = parent;
    var addedAncestor = false;

    if (parent) {
      selectors.push({
        baseScore: 74,
        kind: "parent-child",
        reasons: ["Parent + child path narrows the target within its local container."],
        selector: buildQuickSelector(parent) + " > " + childBase,
        usesAutoGeneratedClass: /[.#][A-Za-z0-9_-]*[a-f0-9]{5,}/i.test(buildQuickSelector(parent) + " > " + childBase),
        usesNth: childBase.indexOf(":nth-") !== -1
      });
    }

    while (ancestor && !addedAncestor) {
      if (ancestor !== parent && (ancestor.id || CONTAINER_HINT_PATTERN.test(ancestor.className || "") || ancestor.getAttribute("aria-label"))) {
        selectors.push({
          baseScore: 78,
          kind: "parent-child",
          reasons: ["Named ancestor + child path may be the best practical UI hook."],
          selector: buildQuickSelector(ancestor) + " " + childBase,
          usesAutoGeneratedClass: /[.#][A-Za-z0-9_-]*[a-f0-9]{5,}/i.test(buildQuickSelector(ancestor) + " " + childBase),
          usesNth: childBase.indexOf(":nth-") !== -1
        });
        addedAncestor = true;
      }
      ancestor = ancestor.parentElement;
    }

    return selectors;
  }

  function addCandidate(candidateMap, candidate) {
    if (!candidate || !candidate.selector) {
      return;
    }

    if (!candidateMap[candidate.selector] || candidate.baseScore > candidateMap[candidate.selector].baseScore) {
      candidateMap[candidate.selector] = candidate;
    }
  }

  function scoreCandidate(candidate, element, rootContext) {
    var documentCount = safeCount(candidate.selector, global.document);
    var rootCount = rootContext.rootType === "shadow-root" ? safeCount(candidate.selector, rootContext.rootNode) : documentCount;
    var score = candidate.baseScore;
    var warnings = [];
    var reasons = (candidate.reasons || []).slice();

    if (documentCount.error) {
      warnings.push("Selector could not be evaluated in document.querySelectorAll(): " + documentCount.error);
      score -= 35;
    } else if (documentCount.count === 0) {
      warnings.push("Matches 0 elements in document.querySelectorAll().");
      score -= 24;
    } else if (documentCount.count === 1) {
      reasons.push("Matches exactly 1 element in document scope.");
      score += 12;
    } else if (documentCount.count > 1 && documentCount.count <= 5) {
      warnings.push("Matches " + documentCount.count + " elements in document scope.");
      score -= 10;
    } else if (documentCount.count > 5) {
      warnings.push("Matches " + documentCount.count + " elements in document scope, so it is probably too broad.");
      score -= 24;
    }

    if (candidate.usesAutoGeneratedClass) {
      warnings.push("Uses class names that look auto-generated or hash-like.");
      score -= 18;
    }

    if (candidate.usesNth) {
      warnings.push("Relies on nth-of-type pathing, which is usually brittle.");
      score -= 16;
    }

    if (element.id && !isStableId(element.id) && candidate.selector.indexOf("#") !== -1) {
      warnings.push("Uses an id that may be dynamic or framework-generated.");
      score -= 14;
    }

    if (rootContext.rootType === "shadow-root" && rootCount && rootCount.count === 1 && documentCount.count === 0) {
      reasons.push("Unique inside the current shadow root.");
      warnings.push("Document-scope query counts are 0 because the element is inside a shadow root.");
      score += 6;
    }

    return {
      kind: candidate.kind,
      matchCount: documentCount.count,
      notes: unique(warnings.concat(reasons)),
      reliability: getReliabilityLabel(score),
      rootScopeMatchCount: rootCount.count,
      score: score,
      selector: candidate.selector,
      warnings: unique(warnings)
    };
  }

  function getReliabilityLabel(score) {
    if (score >= 88) {
      return "high";
    }
    if (score >= 70) {
      return "good";
    }
    if (score >= 54) {
      return "cautious";
    }
    return "risky";
  }

  function analyzeSelectors(element, rootContext) {
    var candidates = Object.create(null);
    var fullPathSelector = buildDomPathSelector(element);
    var ranked;
    var attributeBasedSelectors;
    var classBasedSelectors;
    var parentChildSelectors;
    var fullPathCandidate;
    var shortSelector;
    var safestSelector;
    var selectorWarnings = [];
    var classList = getClassList(element);

    if (element.id) {
      addCandidate(candidates, {
        baseScore: isStableId(element.id) ? 94 : 62,
        kind: "attribute",
        reasons: [isStableId(element.id) ? "Element id looks stable." : "Element id is available, but it may not be stable."],
        selector: "#" + escapeCssIdentifier(element.id),
        usesAutoGeneratedClass: false,
        usesNth: false
      });

      addCandidate(candidates, {
        baseScore: isStableId(element.id) ? 95 : 64,
        kind: "attribute",
        reasons: ["Tag + id is concise and readable."],
        selector: lower(element.tagName) + "#" + escapeCssIdentifier(element.id),
        usesAutoGeneratedClass: false,
        usesNth: false
      });
    }

    getUsefulAttributeSelectors(element).forEach(function (candidate) {
      addCandidate(candidates, candidate);
    });

    getClassSelectors(element).forEach(function (candidate) {
      addCandidate(candidates, candidate);
    });

    getParentChildSelectors(element).forEach(function (candidate) {
      addCandidate(candidates, candidate);
    });

    addCandidate(candidates, {
      baseScore: 48,
      kind: "full-path",
      reasons: ["Full DOM path is explicit, but usually more brittle than semantic selectors."],
      selector: fullPathSelector,
      usesAutoGeneratedClass: classList.some(isHashLike),
      usesNth: fullPathSelector.indexOf(":nth-of-type(") !== -1
    });

    ranked = Object.keys(candidates)
      .map(function (key) {
        return scoreCandidate(candidates[key], element, rootContext);
      })
      .sort(function (left, right) {
        if (right.score !== left.score) {
          return right.score - left.score;
        }
        if ((left.matchCount === 1) !== (right.matchCount === 1)) {
          return left.matchCount === 1 ? -1 : 1;
        }
        return left.selector.length - right.selector.length;
      });

    attributeBasedSelectors = ranked.filter(function (candidate) {
      return candidate.kind === "attribute";
    });
    classBasedSelectors = ranked.filter(function (candidate) {
      return candidate.kind === "class";
    });
    parentChildSelectors = ranked.filter(function (candidate) {
      return candidate.kind === "parent-child";
    });
    fullPathCandidate = ranked.find(function (candidate) {
      return candidate.kind === "full-path";
    }) || null;

    safestSelector =
      ranked.find(function (candidate) {
        return candidate.matchCount === 1 && candidate.score >= 54;
      }) || ranked[0] || null;

    shortSelector =
      ranked
        .filter(function (candidate) {
          return candidate.matchCount === 1;
        })
        .sort(function (left, right) {
          if (left.selector.length !== right.selector.length) {
            return left.selector.length - right.selector.length;
          }
          return right.score - left.score;
        })[0] ||
      ranked[0] ||
      null;

    if (classList.some(isHashLike)) {
      selectorWarnings.push("One or more classes look generated or hash-like.");
    }

    if (!safestSelector || safestSelector.matchCount !== 1) {
      selectorWarnings.push("No clearly unique selector was found in document scope.");
    }

    if (fullPathCandidate && fullPathCandidate.selector.indexOf(":nth-of-type(") !== -1) {
      selectorWarnings.push("Full DOM path relies on nth-of-type segments.");
    }

    if (rootContext.note) {
      selectorWarnings.push(rootContext.note);
    }

    return {
      attributeBasedSelectors: attributeBasedSelectors,
      classBasedSelectors: classBasedSelectors,
      fullDomPathSelector: fullPathCandidate,
      parentChildSelectors: parentChildSelectors,
      ranked: ranked,
      safestSelector: safestSelector,
      shortSelector: shortSelector,
      warnings: unique(selectorWarnings.concat((safestSelector && safestSelector.warnings) || []))
    };
  }

  function getUsefulAttributes(element) {
    var attributes = collectAttributes(element).all;
    var useful = {};

    Object.keys(attributes).forEach(function (name) {
      if (/^(class|id|style)$/.test(name)) {
        return;
      }

      if (
        name.indexOf("data-") === 0 ||
        name.indexOf("aria-") === 0 ||
        STABLE_ATTRS.indexOf(name) !== -1 ||
        /^(for|value|tabindex)$/.test(name)
      ) {
        useful[name] = attributes[name];
      }
    });

    return useful;
  }

  function isLikelyContainer(element) {
    var computed = global.getComputedStyle ? global.getComputedStyle(element) : null;
    var rect = element.getBoundingClientRect();
    var signals = [];
    var text = [element.id, element.className, element.getAttribute("role")].join(" ");

    if (CONTAINER_HINT_PATTERN.test(text)) {
      signals.push("name suggests container/card/wrapper semantics");
    }
    if (element.childElementCount >= 2) {
      signals.push("contains multiple child elements");
    }
    if (computed && /flex|grid|block|contents/.test(computed.display)) {
      signals.push("layout display is " + computed.display);
    }
    if (computed && /auto|scroll|overlay/.test([computed.overflow, computed.overflowX, computed.overflowY].join(" "))) {
      signals.push("acts like a scrollable region");
    }
    if (rect.width >= 140 || rect.height >= 48) {
      signals.push("dimensions are container-like");
    }
    if (/(group|region|list|listitem|article|main|navigation|dialog|form|toolbar|tabpanel)/.test(lower(element.getAttribute("role")))) {
      signals.push("role suggests a wrapper or structural container");
    }

    return {
      isContainer: signals.length >= 2,
      signals: signals
    };
  }

  function collectAncestors(element) {
    var ancestors = [];
    var depth = 1;
    var current = element.parentElement;
    var rootContext = getRootContext(element);

    while (current && depth <= MAX_ANCESTORS) {
      var usefulAttributes = getUsefulAttributes(current);
      var dimensions = getRectSnapshot(current);
      var containerStatus = isLikelyContainer(current);
      var clickable = isClickableElement(current);
      var effects = getEffectSnapshot(current);
      var note = null;

      if (clickable && !isClickableElement(element) && INLINE_CHILD_TAGS[lower(element.tagName)]) {
        note = "This parent is clickable while the selected child is a small inline element. Styling or targeting the parent may be safer.";
      } else if (containerStatus.isContainer && !getVisibleTextSummary(element)) {
        note = "This ancestor looks like the nearest meaningful wrapper.";
      }

      ancestors.push({
        depth: depth,
        dimensions: {
          height: dimensions.height,
          width: dimensions.width
        },
        id: current.id || null,
        isClickable: clickable,
        isLikelyContainer: containerStatus.isContainer,
        label: getBestLabel(current) || null,
        note: note,
        role: current.getAttribute("role") || null,
        shortSelector: buildQuickSelector(current),
        signals: containerStatus.signals,
        structure: getStructuralIdentity(current),
        tagName: lower(current.tagName),
        usefulAttributes: usefulAttributes,
        effects: effects,
        classList: getClassList(current),
        classString: normalizeWhitespace(current.className),
        unstableClasses: getClassList(current).filter(isHashLike)
      });

      current = current.parentElement;
      depth += 1;
    }

    return {
      coverage: {
        capturedCount: ancestors.length,
        limit: MAX_ANCESTORS,
        rootType: rootContext.rootType,
        termination: current ? "max-depth" : rootContext.rootType + "-root",
        truncated: !!current
      },
      items: ancestors
    };
  }

  function getDirectTextNodes(element) {
    return Array.prototype.slice
      .call(element.childNodes || [])
      .filter(function (node) {
        return node && node.nodeType === 3 && normalizeWhitespace(node.textContent);
      })
      .slice(0, 5)
      .map(function (node) {
        return truncate(node.textContent, 120);
      });
  }

  function describeChildElement(element) {
    return {
      id: element.id || null,
      isClickable: isClickableElement(element),
      role: element.getAttribute("role") || null,
      selector: buildQuickSelector(element),
      tagName: lower(element.tagName),
      textSummary: getVisibleTextSummary(element) || null,
      classList: getClassList(element)
    };
  }

  function isUsefulDescendant(element) {
    var tagName = lower(element.tagName);
    if (tagName === "script" || tagName === "style" || tagName === "path") {
      return false;
    }

    if (/^(a|button|img|input|label|select|svg|textarea)$/.test(tagName)) {
      return true;
    }

    if (element.hasAttribute("role") || element.hasAttribute("aria-label")) {
      return true;
    }

    if (STABLE_DATA_ATTRS.some(function (name) { return element.hasAttribute(name); })) {
      return true;
    }

    return !!getVisibleTextSummary(element);
  }

  function collectChildren(element) {
    var immediateChildren = Array.prototype.slice
      .call(element.children || [])
      .slice(0, MAX_CHILDREN)
      .map(describeChildElement);
    var directTextNodes = getDirectTextNodes(element);
    var usefulDescendants = [];
    var seen = [];
    var inspected = 0;
    var walker;
    var current;

    if (global.document && typeof global.document.createTreeWalker === "function") {
      walker = global.document.createTreeWalker(
        element,
        global.NodeFilter ? global.NodeFilter.SHOW_ELEMENT : 1,
        null
      );
      current = walker.nextNode();

      while (current && usefulDescendants.length < MAX_DESCENDANTS && inspected < MAX_TREEWALK_NODES) {
        if (current !== element && isUsefulDescendant(current)) {
          var selector = buildQuickSelector(current);
          if (seen.indexOf(selector) === -1) {
            seen.push(selector);
            usefulDescendants.push({
              id: current.id || null,
              isClickable: isClickableElement(current),
              reason: getDescendantReason(current),
              role: current.getAttribute("role") || null,
              selector: selector,
              tagName: lower(current.tagName),
              textSummary: getVisibleTextSummary(current) || null
            });
          }
        }

        inspected += 1;
        current = walker.nextNode();
      }
    }

    return {
      directTextNodes: directTextNodes,
      immediateChildren: immediateChildren,
      usefulDescendants: usefulDescendants
    };
  }

  function getDescendantReason(element) {
    var tagName = lower(element.tagName);

    if (/^(button|a|input|select|textarea)$/.test(tagName)) {
      return "interactive control";
    }
    if (/^(img|svg)$/.test(tagName)) {
      return "visual child";
    }
    if (element.hasAttribute("aria-label")) {
      return "named via aria-label";
    }
    if (element.hasAttribute("role")) {
      return "role-based child";
    }
    if (STABLE_DATA_ATTRS.some(function (name) { return element.hasAttribute(name); })) {
      return "has a stable-looking data attribute";
    }
    return "text-bearing descendant";
  }

  function findScrollContainer(element) {
    var current = element.parentElement;

    while (current) {
      var style = global.getComputedStyle ? global.getComputedStyle(current) : null;
      if (
        style &&
        /auto|scroll|overlay/.test([style.overflow, style.overflowX, style.overflowY].join(" ")) &&
        (current.scrollHeight > current.clientHeight || current.scrollWidth > current.clientWidth)
      ) {
        return {
          label: getBestLabel(current) || null,
          selector: buildQuickSelector(current),
          tagName: lower(current.tagName)
        };
      }
      current = current.parentElement;
    }

    return null;
  }

  function findNearestMeaningfulContainer(ancestors) {
    for (var index = 0; index < ancestors.length; index += 1) {
      var ancestor = ancestors[index];
      if (ancestor.isLikelyContainer && (ancestor.id || ancestor.role || ancestor.label || Object.keys(ancestor.usefulAttributes).length)) {
        return {
          depth: ancestor.depth,
          label: ancestor.label,
          selector: ancestor.shortSelector,
          tagName: ancestor.tagName
        };
      }
    }

    return null;
  }

  function isNonDefaultEffectValue(value, defaultValues) {
    var normalized = lower(normalizeWhitespace(value));
    return !!normalized && (defaultValues || []).indexOf(normalized) === -1;
  }

  function hasNamedCssAnimation(effects) {
    return (
      effects &&
      effects.animation &&
      normalizeWhitespace(effects.animation.name)
        .split(",")
        .some(function (name) {
          return !!normalizeWhitespace(name) && lower(name) !== "none";
        })
    );
  }

  function summarizeAnimationStates(animations) {
    return unique(
      ((animations && animations.items) || []).map(function (animation) {
        return [
          animation.type,
          animation.name || "unnamed",
          animation.playState,
          animation.finishedWithFillEffect ? "finished with retained fill" : null
        ]
          .filter(Boolean)
          .join(" ");
      })
    ).join("; ");
  }

  function deriveEffectRisks(selectedEffects, ancestors) {
    var items = [];
    var maxItems = 16;
    var total = 0;

    function add(type, node, reason, depth) {
      total += 1;
      if (items.length < maxItems) {
        items.push({
          depth: depth,
          node: node,
          reason: reason,
          type: type
        });
      }
    }

    if (
      isNonDefaultEffectValue(selectedEffects.backdropFilter, ["none"]) ||
      isNonDefaultEffectValue(selectedEffects.webkitBackdropFilter, ["none"])
    ) {
      add(
        "selected-filter",
        "selected element",
        "The selected node has a backdrop filter, so the final pixels can depend on content and compositing behind it.",
        0
      );
    }
    if (isNonDefaultEffectValue(selectedEffects.filter, ["none"])) {
      add(
        "selected-filter",
        "selected element",
        "The selected node has a filter that can change its painted result after ordinary style calculation.",
        0
      );
    }

    ancestors.forEach(function (ancestor) {
      var effects = ancestor.effects;
      var node = ancestor.shortSelector;
      var animationState = summarizeAnimationStates(effects.animations);

      if (effects.hasTransform) {
        add(
          "ancestor-transform",
          node,
          "Ancestor transform state is " +
            [
              "transform " + (effects.transform || "none"),
              "translate " + (effects.translate || "none"),
              "rotate " + (effects.rotate || "none"),
              "scale " + (effects.scale || "none")
            ].join(", ") +
            (effects.transformIsIdentityMatrix
              ? ". The matrix is visually identity, but it still creates a transformed context."
              : effects.transformState.indexOf("identity individual") === 0
                ? ". The individual transform is visually identity, but it still creates a transformed context."
              : "."),
          ancestor.depth
        );
      }
      if (
        isNonDefaultEffectValue(effects.filter, ["none"]) ||
        isNonDefaultEffectValue(effects.backdropFilter, ["none"]) ||
        isNonDefaultEffectValue(effects.webkitBackdropFilter, ["none"])
      ) {
        add(
          "ancestor-filter",
          node,
          "An ancestor filter or backdrop filter can change how this subtree is painted and composited.",
          ancestor.depth
        );
      }
      if (hasNamedCssAnimation(effects) || (effects.animations && effects.animations.items.length)) {
        add(
          "ancestor-animation",
          node,
          "An ancestor has animation state" +
            (animationState ? ": " + animationState + "." : " in its computed CSS."),
          ancestor.depth
        );
      }
      if (effects.stickyLike) {
        add(
          "sticky-context",
          node,
          "This ancestor is sticky-like" +
            (effects.dataSticky !== null ? " and carries data-sticky=" + JSON.stringify(effects.dataSticky) : "") +
            ". Scroll state can affect its position and paint context.",
          ancestor.depth
        );
      }
      if (isNonDefaultEffectValue(effects.contain, ["none"])) {
        add(
          "containment",
          node,
          "This ancestor uses contain: " + effects.contain + ", which can establish layout, paint, size, or style containment.",
          ancestor.depth
        );
      }
      if (isNonDefaultEffectValue(effects.isolation, ["auto"])) {
        add(
          "isolation",
          node,
          "This ancestor uses isolation: " + effects.isolation + ", creating an isolated stacking context.",
          ancestor.depth
        );
      }
      if (isNonDefaultEffectValue(effects.willChange, ["auto"])) {
        add(
          "will-change",
          node,
          "This ancestor declares will-change: " + effects.willChange + ", which may pre-create a compositing or containing context.",
          ancestor.depth
        );
      }
    });

    return {
      items: items,
      total: total,
      truncated: total > items.length
    };
  }

  function deriveInsights(element, selectors, ancestors, children) {
    var betterParentTargets = [];
    var betterChildTargets = [];
    var likelyContainerCandidates = ancestors
      .filter(function (ancestor) {
        return ancestor.isLikelyContainer;
      })
      .slice(0, 3)
      .map(function (ancestor) {
        return {
          depth: ancestor.depth,
          reason: ancestor.signals.join("; "),
          selector: ancestor.shortSelector
        };
      });

    if (ancestors.length) {
      var parent = ancestors[0];
      if (parent.isClickable && INLINE_CHILD_TAGS[lower(element.tagName)]) {
        betterParentTargets.push({
          reason: "The selected element is a small inline child inside a clickable parent. The parent is usually the better hook for full-control styling or behavior changes.",
          selector: parent.shortSelector
        });
      }

      if (selectors.safestSelector && selectors.safestSelector.score < 70 && parent.isLikelyContainer) {
        betterParentTargets.push({
          reason: "The selected child does not have a strong standalone selector, but the parent looks like a named container.",
          selector: parent.shortSelector
        });
      }
    }

    if (children.usefulDescendants.length && (element.childElementCount >= 3 || isLikelyContainer(element).isContainer)) {
      children.usefulDescendants.slice(0, 3).forEach(function (descendant) {
        if (descendant.isClickable || descendant.role || descendant.reason !== "text-bearing descendant") {
          betterChildTargets.push({
            reason: "This descendant is more specific than the selected container and may be the right layer for a focused tweak.",
            selector: descendant.selector
          });
        }
      });
    }

    if (/^(button|a)$/.test(lower(element.tagName))) {
      children.immediateChildren.forEach(function (child) {
        if (/^(svg|img|span)$/.test(child.tagName)) {
          betterChildTargets.push({
            reason: "Target this child if you only want to change the icon or label without affecting the full control shell.",
            selector: child.selector
          });
        }
      });
    }

    return {
      betterChildTargets: unique(betterChildTargets),
      betterParentTargets: unique(betterParentTargets),
      likelyContainerCandidates: likelyContainerCandidates,
      notes: unique(
        []
          .concat(
            selectors.warnings.length ? ["Review selector warnings before applying a broad theme rule."] : [],
            betterParentTargets.length ? ["A parent wrapper may be the better target for whole-control styling."] : [],
            betterChildTargets.length ? ["A descendant may be the better target for fine-grained styling."] : []
          )
      ),
      warnings: unique(selectors.warnings.slice())
    };
  }

  function isInterestingCssProperty(name) {
    var index;
    var group;
    if (!name) {
      return false;
    }

    if (name.indexOf("--") === 0) {
      return true;
    }

    for (index = 0; index < CSS_TRACE_GROUPS.length; index += 1) {
      group = CSS_TRACE_GROUPS[index];
      if (group.properties.indexOf(name) !== -1) {
        return true;
      }
    }

    return false;
  }

  function safeElementMatches(element, selector) {
    try {
      return !!selector && typeof element.matches === "function" && element.matches(selector);
    } catch (error) {
      return false;
    }
  }

  function getCascadeParent(element) {
    var rootNode;

    if (!element) {
      return null;
    }

    if (element.parentElement) {
      return element.parentElement;
    }

    if (typeof element.getRootNode === "function") {
      rootNode = element.getRootNode();
      if (typeof global.ShadowRoot !== "undefined" && rootNode instanceof global.ShadowRoot) {
        return rootNode.host || null;
      }
    }

    return null;
  }

  function createCssTraceContext(rootContext) {
    return {
      inaccessibleStyleSheets: [],
      matchedRuleCache: typeof WeakMap !== "undefined" ? new WeakMap() : [],
      notes: [],
      rootContext: rootContext,
      scannedRules: 0,
      styleSheets: getRelevantStyleSheets(rootContext),
      truncated: false
    };
  }

  function getRelevantStyleSheets(rootContext) {
    var styleSheets = [];
    var seen = [];

    function pushStyleSheet(styleSheet) {
      if (!styleSheet || seen.indexOf(styleSheet) !== -1) {
        return;
      }

      seen.push(styleSheet);
      styleSheets.push(styleSheet);
    }

    function pushList(list) {
      Array.prototype.forEach.call(list || [], pushStyleSheet);
    }

    if (global.document) {
      pushList(global.document.styleSheets);
      pushList(global.document.adoptedStyleSheets);
    }

    if (rootContext && rootContext.rootNode && rootContext.rootNode !== global.document) {
      pushList(rootContext.rootNode.styleSheets);
      pushList(rootContext.rootNode.adoptedStyleSheets);
    }

    return styleSheets;
  }

  function describeStyleSheet(styleSheet) {
    var ownerNode;

    if (!styleSheet) {
      return "unknown stylesheet";
    }

    if (styleSheet.href) {
      return truncate(styleSheet.href, 140);
    }

    ownerNode = styleSheet.ownerNode;
    if (ownerNode && ownerNode.tagName) {
      return "inline <" + lower(ownerNode.tagName) + (ownerNode.id ? "#" + ownerNode.id : "") + ">";
    }

    if (styleSheet.ownerRule && styleSheet.ownerRule.href) {
      return "import " + truncate(styleSheet.ownerRule.href, 140);
    }

    return "inline stylesheet";
  }

  function readCssRulesSafely(styleSheet, cssContext) {
    try {
      return styleSheet.cssRules || styleSheet.rules || [];
    } catch (error) {
      cssContext.inaccessibleStyleSheets.push(
        describeStyleSheet(styleSheet) + ": " + (error && error.message ? error.message : String(error))
      );
      return null;
    }
  }

  function shouldEnterConditionalRule(rule) {
    if (!rule) {
      return false;
    }

    if (rule.type === 4 && global.matchMedia && rule.conditionText) {
      try {
        return global.matchMedia(rule.conditionText).matches;
      } catch (error) {
        return false;
      }
    }

    if (rule.type === 12 && global.CSS && typeof global.CSS.supports === "function" && rule.conditionText) {
      try {
        return global.CSS.supports(rule.conditionText);
      } catch (error) {
        return false;
      }
    }

    return true;
  }

  function getRuleContextLabel(rule) {
    if (!rule) {
      return null;
    }

    if (rule.type === 4 && rule.conditionText) {
      return "@media " + rule.conditionText;
    }

    if (rule.type === 12 && rule.conditionText) {
      return "@supports " + rule.conditionText;
    }

    if (rule.type === 3 && rule.href) {
      return "@import " + truncate(rule.href, 100);
    }

    if (typeof rule.cssText === "string") {
      return truncate(rule.cssText.split("{")[0], 100);
    }

    return "@group";
  }

  function collectRuleDeclarations(style) {
    var declarations = [];
    var index;
    var name;
    var value;

    if (!style) {
      return declarations;
    }

    for (index = 0; index < style.length; index += 1) {
      name = style[index];
      value = normalizeWhitespace(style.getPropertyValue(name));
      if (!value || !isInterestingCssProperty(name)) {
        continue;
      }

      declarations.push(name + ": " + truncate(value, 180));
      if (declarations.length >= 8) {
        break;
      }
    }

    return declarations;
  }

  function getMatchedCssRules(element, cssContext) {
    var cached = cacheGet(cssContext.matchedRuleCache, element);
    var matches = [];

    function walkRuleList(ruleList, parentStyleSheet, contextStack) {
      var rule;
      var index;
      var childRules;

      if (!ruleList || cssContext.truncated) {
        return;
      }

      for (index = 0; index < ruleList.length; index += 1) {
        if (cssContext.truncated) {
          return;
        }

        rule = ruleList[index];
        if (!rule) {
          continue;
        }

        if (rule.type === 1) {
          cssContext.scannedRules += 1;
          if (cssContext.scannedRules >= MAX_CSS_RULES_SCANNED) {
            cssContext.truncated = true;
            return;
          }

          if (!safeElementMatches(element, rule.selectorText)) {
            continue;
          }

          matches.push({
            context: contextStack.slice(),
            declarations: collectRuleDeclarations(rule.style),
            rule: rule,
            selector: rule.selectorText,
            source: describeStyleSheet(rule.parentStyleSheet || parentStyleSheet)
          });
          continue;
        }

        if (rule.type === 3 && rule.styleSheet) {
          childRules = readCssRulesSafely(rule.styleSheet, cssContext);
          walkRuleList(childRules, rule.styleSheet, contextStack.concat(getRuleContextLabel(rule)));
          continue;
        }

        if (rule.cssRules && shouldEnterConditionalRule(rule)) {
          walkRuleList(rule.cssRules, parentStyleSheet, contextStack.concat(getRuleContextLabel(rule)));
        }
      }
    }

    if (cached) {
      return cached;
    }

    cssContext.styleSheets.forEach(function (styleSheet) {
      var rules = readCssRulesSafely(styleSheet, cssContext);
      walkRuleList(rules, styleSheet, []);
    });

    if (matches.length > MAX_MATCHED_CSS_RULES) {
      matches = matches.slice(matches.length - MAX_MATCHED_CSS_RULES);
      cssContext.notes.push("Matched CSS rule output was trimmed to the most recent " + MAX_MATCHED_CSS_RULES + " rules.");
    }

    cacheSet(cssContext.matchedRuleCache, element, matches);
    return matches;
  }

  function getDeclaredPropertyFromStyle(style, properties) {
    var index;
    var propertyName;
    var value;

    if (!style) {
      return null;
    }

    for (index = 0; index < properties.length; index += 1) {
      propertyName = properties[index];
      value = normalizeWhitespace(style.getPropertyValue(propertyName));
      if (!value) {
        continue;
      }

      return {
        important: style.getPropertyPriority(propertyName) === "important",
        property: propertyName,
        value: value
      };
    }

    return null;
  }

  function getInlineStyleSource(element, group) {
    var declaration = getDeclaredPropertyFromStyle(element && element.style, group.properties);

    if (!declaration) {
      return null;
    }

    return {
      context: null,
      important: declaration.important,
      node: element,
      property: declaration.property,
      selector: null,
      sourceType: "inline-style",
      stylesheet: null,
      value: declaration.value
    };
  }

  function getCssRuleSource(element, group, cssContext) {
    var matchedRules = getMatchedCssRules(element, cssContext);
    var index;
    var declaration;

    for (index = matchedRules.length - 1; index >= 0; index -= 1) {
      declaration = getDeclaredPropertyFromStyle(matchedRules[index].rule.style, group.properties);
      if (!declaration) {
        continue;
      }

      return {
        context: matchedRules[index].context,
        important: declaration.important,
        node: element,
        property: declaration.property,
        selector: matchedRules[index].selector,
        sourceType: "css-rule",
        stylesheet: matchedRules[index].source,
        value: declaration.value
      };
    }

    return null;
  }

  function getDirectStyleSource(element, group, cssContext) {
    return getInlineStyleSource(element, group) || getCssRuleSource(element, group, cssContext);
  }

  function getInheritedStyleSource(element, group, cssContext) {
    var current = getCascadeParent(element);
    var depth = 1;
    var source;

    while (current && depth <= MAX_ANCESTORS) {
      source = getDirectStyleSource(current, group, cssContext);
      if (source) {
        source = {
          context: source.context,
          important: source.important,
          inheritedFrom: buildQuickSelector(current),
          node: current,
          property: source.property,
          selector: source.selector,
          sourceType: source.sourceType === "inline-style" ? "inherited-inline-style" : "inherited-css-rule",
          stylesheet: source.stylesheet,
          value: source.value
        };
        return source;
      }

      current = getCascadeParent(current);
      depth += 1;
    }

    return null;
  }

  function getComputedTraceValue(group, snapshot, computedStyle) {
    switch (group.label) {
      case "background":
        return snapshot.background;
      case "border":
        return snapshot.border + (snapshot.borderRadius ? " | radius " + snapshot.borderRadius : "");
      case "box-shadow":
        return snapshot.boxShadow;
      case "color":
        return snapshot.color;
      case "display":
        return snapshot.display;
      case "font-family":
        return snapshot.font ? snapshot.font.family : "";
      case "font-size":
        return snapshot.font ? snapshot.font.size : "";
      case "font-weight":
        return snapshot.font ? snapshot.font.weight : "";
      case "line-height":
        return snapshot.font ? snapshot.font.lineHeight : "";
      case "margin":
        return snapshot.margin;
      case "opacity":
        return snapshot.opacity;
      case "overflow":
        return snapshot.overflow ? snapshot.overflow.all : "";
      case "padding":
        return snapshot.padding;
      case "pointer-events":
        return snapshot.pointerEvents;
      case "position":
        return snapshot.position;
      case "transform":
        return snapshot.transform;
      case "visibility":
        return snapshot.visibility;
      case "z-index":
        return snapshot.zIndex;
      default:
        return computedStyle ? normalizeWhitespace(computedStyle.getPropertyValue(group.properties[0])) : "";
    }
  }

  function extractVariableNames(value) {
    var matches = [];
    String(value || "").replace(/var\(\s*(--[A-Za-z0-9_-]+)/g, function (_, variableName) {
      matches.push(variableName);
      return _;
    });
    return unique(matches);
  }

  function getVariableDefinitionOnNode(element, variableName, cssContext) {
    var inlineValue = element && element.style ? normalizeWhitespace(element.style.getPropertyValue(variableName)) : "";
    var matchedRules;
    var index;
    var value;

    if (inlineValue) {
      return {
        context: null,
        node: element,
        selector: null,
        sourceType: "inline-style",
        stylesheet: null,
        value: inlineValue
      };
    }

    matchedRules = getMatchedCssRules(element, cssContext);
    for (index = matchedRules.length - 1; index >= 0; index -= 1) {
      value = normalizeWhitespace(matchedRules[index].rule.style.getPropertyValue(variableName));
      if (!value) {
        continue;
      }

      return {
        context: matchedRules[index].context,
        node: element,
        selector: matchedRules[index].selector,
        sourceType: "css-rule",
        stylesheet: matchedRules[index].source,
        value: value
      };
    }

    return null;
  }

  function resolveVariableTrace(variableName, element, cssContext, depth, seen) {
    var current = element;
    var definition;
    var computedValue;
    var nestedVariables;
    var result;

    if (depth > MAX_CSS_VARIABLE_CHAIN) {
      return {
        name: variableName,
        note: "Stopped after the max variable trace depth.",
        value: null
      };
    }

    if (seen[variableName]) {
      return {
        name: variableName,
        note: "Stopped to avoid a recursive variable loop.",
        value: null
      };
    }

    seen[variableName] = true;

    while (current) {
      definition = getVariableDefinitionOnNode(current, variableName, cssContext);
      if (definition) {
        result = {
          context: definition.context ? definition.context.join(" > ") : null,
          name: variableName,
          nodeSelector: buildQuickSelector(definition.node),
          selector: definition.selector,
          sourceType: definition.sourceType,
          stylesheet: definition.stylesheet,
          value: truncate(definition.value, 180)
        };
        nestedVariables = extractVariableNames(definition.value);
        if (nestedVariables.length) {
          result.dependsOn = nestedVariables.map(function (nestedVariable) {
            return resolveVariableTrace(nestedVariable, definition.node, cssContext, depth + 1, seen);
          });
        }
        return result;
      }

      current = getCascadeParent(current);
    }

    computedValue = normalizeWhitespace(global.getComputedStyle(element).getPropertyValue(variableName));
    return {
      name: variableName,
      note: computedValue
        ? "Resolved value is available, but the definition site was not found in accessible CSS."
        : "Definition site was not found in accessible CSS.",
      value: truncate(computedValue, 180) || null
    };
  }

  function traceVariablesForValue(value, element, cssContext) {
    return extractVariableNames(value).map(function (variableName) {
      return resolveVariableTrace(variableName, element, cssContext, 0, {});
    });
  }

  function summarizeCssRule(match) {
    var variableNames = [];

    match.declarations.forEach(function (declaration) {
      variableNames = variableNames.concat(extractVariableNames(declaration));
    });

    return {
      context: match.context.length ? match.context.join(" > ") : null,
      declarations: match.declarations,
      selector: match.selector,
      source: match.source,
      variableNames: unique(variableNames)
    };
  }

  function collectVariableSummary(propertyTraces) {
    var summaries = Object.create(null);

    function visit(variableTrace) {
      if (!variableTrace || !variableTrace.name || summaries[variableTrace.name]) {
        return;
      }

      summaries[variableTrace.name] = variableTrace;
      (variableTrace.dependsOn || []).forEach(visit);
    }

    propertyTraces.forEach(function (trace) {
      (trace.variableChain || []).forEach(visit);
    });

    return Object.keys(summaries).map(function (name) {
      return summaries[name];
    });
  }

  function traceCssGroup(element, group, cssContext, snapshot) {
    var computedStyle = global.getComputedStyle ? global.getComputedStyle(element) : null;
    var computedValue = getComputedTraceValue(group, snapshot, computedStyle);
    var source = getDirectStyleSource(element, group, cssContext);
    var note = null;

    if (!source && group.inherits) {
      source = getInheritedStyleSource(element, group, cssContext);
    }

    if (!source) {
      note = "No direct accessible source was found. The computed value may come from defaults, inherited browser styles, or inaccessible stylesheets.";
    } else if (source.sourceType.indexOf("inherited-") === 0) {
      note = "Value appears to be inherited from " + source.inheritedFrom + ".";
    } else if (source.property !== group.properties[0]) {
      note = "Value is being driven by `" + source.property + "` rather than the shorthand group label.";
    }

    return {
      computedValue: truncate(computedValue, 200) || "n/a",
      group: group.label,
      note: note,
      source: source
        ? {
            context: source.context ? source.context.join(" > ") : null,
            declaredProperty: source.property,
            declaredValue: truncate(source.value, 200),
            important: source.important,
            inheritedFrom: source.inheritedFrom || null,
            nodeSelector: buildQuickSelector(source.node),
            selector: source.selector,
            sourceType: source.sourceType,
            stylesheet: source.stylesheet
          }
        : null,
      variableChain: source ? traceVariablesForValue(source.value, source.node || element, cssContext) : []
    };
  }

  function buildCssTrace(element, rootContext, snapshot) {
    var cssContext = createCssTraceContext(rootContext);
    var matchedRules = getMatchedCssRules(element, cssContext);
    var propertyTraces = CSS_TRACE_GROUPS.map(function (group) {
      return traceCssGroup(element, group, cssContext, snapshot);
    });
    var notes = [];

    if (cssContext.truncated) {
      notes.push("CSS scanning was truncated after " + MAX_CSS_RULES_SCANNED + " accessible style rules.");
    }

    if (cssContext.inaccessibleStyleSheets.length) {
      notes.push("Some stylesheets could not be read from this DevTools context, usually because of cross-origin restrictions.");
    }

    if (!matchedRules.length) {
      notes.push("No matching accessible CSS rules were found for the selected element.");
    }

    return {
      inaccessibleStyleSheets: unique(cssContext.inaccessibleStyleSheets).slice(0, 6),
      matchedRules: matchedRules.slice(-MAX_CSS_RULES_IN_REPORT).map(summarizeCssRule),
      notes: unique(notes.concat(cssContext.notes)),
      propertyTraces: propertyTraces,
      stats: {
        accessibleStyleSheetCount: cssContext.styleSheets.length,
        matchedRuleCount: matchedRules.length,
        scannedRuleCount: cssContext.scannedRules,
        truncated: cssContext.truncated
      },
      variableTraces: collectVariableSummary(propertyTraces)
    };
  }

  function buildReportWarnings(element, rootContext) {
    var warnings = [];

    if (rootContext && rootContext.note) {
      warnings.push(rootContext.note);
    }

    if (element && element.isConnected === false) {
      warnings.push(
        "Selected element is not currently connected to the live document. This often means a stored global variable is pointing to an old node from before a re-render."
      );
    }

    return warnings;
  }

  function buildReport(element, selectionNote) {
    var attributes = collectAttributes(element);
    var snapshot = getComputedSnapshot(element);
    var rootContext = getRootContext(element);
    var ancestorContext = collectAncestors(element);
    var ancestors = ancestorContext.items;
    var children = collectChildren(element);
    var selectors = analyzeSelectors(element, rootContext);
    var insights = deriveInsights(element, selectors, ancestors, children);
    var classList = getClassList(element);
    var cssTrace = buildCssTrace(element, rootContext, snapshot);
    var warnings = buildReportWarnings(element, rootContext);
    insights.effectCompositorRisks = deriveEffectRisks(snapshot.effects, ancestors);

    return {
      meta: {
        autoCopy: "pending",
        elementIdentity: buildDevtoolsIdentity(element),
        lastSend: null,
        note: selectionNote || null,
        receiverSendUrl: getReceiverSendUrl(),
        timestamp: new Date().toISOString(),
        tool: TOOL_NAME,
        version: VERSION,
        warnings: warnings
      },
      document: {
        rootType: rootContext.rootType,
        shadowHostSelector: rootContext.hostSelector || null,
        title: global.document && global.document.title ? global.document.title : "",
        url: global.location && global.location.href ? global.location.href : ""
      },
      selection: {
        ariaAttributes: attributes.aria,
        attributes: attributes.all,
        classList: classList,
        classString: normalizeWhitespace(element.className),
        elementIdentity: buildDevtoolsIdentity(element),
        dataAttributes: attributes.data,
        href: element.getAttribute("href") || null,
        id: element.id || null,
        isClickable: isClickableElement(element, global.getComputedStyle ? global.getComputedStyle(element) : null),
        isConnected: !!element.isConnected,
        isFocusable: isFocusableElement(element),
        isInsideShadowRoot: !!rootContext.isInsideShadowRoot,
        isVisible: isVisibleElement(element, snapshot),
        name: element.getAttribute("name") || null,
        outerHtmlExcerpt: getOuterHtmlExcerpt(element),
        role: element.getAttribute("role") || null,
        src: element.getAttribute("src") || null,
        tagName: lower(element.tagName),
        textSummary: getVisibleTextSummary(element),
        title: element.getAttribute("title") || null
      },
      selectors: selectors,
      ancestors: ancestors,
      ancestorCoverage: ancestorContext.coverage,
      children: children,
      layout: {
        animation: snapshot.animation,
        animations: snapshot.animations,
        backdropFilter: snapshot.backdropFilter,
        background: snapshot.background,
        border: snapshot.border,
        borderRadius: snapshot.borderRadius,
        boxShadow: snapshot.boxShadow,
        color: snapshot.color,
        contain: snapshot.contain,
        dataSticky: snapshot.dataSticky,
        display: snapshot.display,
        effects: snapshot.effects,
        filter: snapshot.filter,
        font: snapshot.font,
        isolation: snapshot.isolation,
        isSticky: snapshot.isSticky,
        margin: snapshot.margin,
        mixBlendMode: snapshot.mixBlendMode,
        opacity: snapshot.opacity,
        overflow: snapshot.overflow,
        padding: snapshot.padding,
        pointerEvents: snapshot.pointerEvents,
        position: snapshot.position,
        rect: snapshot.rect,
        rotate: snapshot.rotate,
        scale: snapshot.scale,
        transform: snapshot.transform,
        transformIsIdentityMatrix: snapshot.transformIsIdentityMatrix,
        transformState: snapshot.transformState,
        transition: snapshot.transition,
        translate: snapshot.translate,
        visibility: snapshot.visibility,
        webkitBackdropFilter: snapshot.webkitBackdropFilter,
        willChange: snapshot.willChange,
        zIndex: snapshot.zIndex
      },
      cssTrace: cssTrace,
      context: {
        nearestMeaningfulContainer: findNearestMeaningfulContainer(ancestors),
        rootNote: rootContext.note,
        shadow: {
          hostSelector: rootContext.hostSelector || null,
          isInsideShadowRoot: !!rootContext.isInsideShadowRoot,
          warning: rootContext.note || null
        },
        scrollContainer: findScrollContainer(element),
        visible: isVisibleElement(element, snapshot)
      },
      insights: insights
    };
  }

  function describeCssSource(source) {
    if (!source) {
      return "no accessible source";
    }

    var parts = [source.sourceType];

    if (source.inheritedFrom) {
      parts.push("from " + source.inheritedFrom);
    }

    if (source.selector) {
      parts.push("selector " + source.selector);
    }

    if (source.stylesheet) {
      parts.push("sheet " + source.stylesheet);
    }

    if (source.context) {
      parts.push(source.context);
    }

    return parts.join(" | ");
  }

  function summarizeVariableTrace(variableTrace) {
    if (!variableTrace) {
      return "";
    }

    var parts = [variableTrace.name];

    if (variableTrace.value) {
      parts.push("= " + variableTrace.value);
    }

    if (variableTrace.nodeSelector) {
      parts.push("@ " + variableTrace.nodeSelector);
    }

    if (variableTrace.selector) {
      parts.push("via " + variableTrace.selector);
    }

    if (variableTrace.note) {
      parts.push(variableTrace.note);
    }

    if (variableTrace.dependsOn && variableTrace.dependsOn.length) {
      parts.push("-> " + variableTrace.dependsOn.map(summarizeVariableTrace).join(" -> "));
    }

    return truncate(parts.join(" "), 320);
  }

  function formatAnimationSummary(animation) {
    var timing = animation.computedTiming || animation.timing || {};
    var parts = [
      animation.type,
      animation.name || "unnamed",
      "playState " + animation.playState,
      "finished " + yesNo(animation.finished),
      "fill " + (animation.fill || "n/a")
    ];

    if (typeof timing.duration !== "undefined") {
      parts.push("duration " + timing.duration + "ms");
    }
    if (typeof timing.delay !== "undefined") {
      parts.push("delay " + timing.delay + "ms");
    }
    if (typeof timing.progress !== "undefined") {
      parts.push("progress " + timing.progress);
    }
    if (animation.finishedWithFillEffect) {
      parts.push("finished effect may still affect layout or paint through fill");
    }

    return parts.join(" | ");
  }

  function formatEffectSnapshot(effects) {
    var animation = effects.animation || {};
    var overflow = effects.overflow || {};
    var transition = effects.transition || {};

    return [
      "backdrop-filter " + formatCode(effects.backdropFilter || "none"),
      "-webkit-backdrop-filter " + formatCode(effects.webkitBackdropFilter || "none"),
      "filter " + formatCode(effects.filter || "none"),
      "transform " + formatCode(effects.transform || "none") + " (" + effects.transformState + ")",
      "translate " + formatCode(effects.translate || "none"),
      "rotate " + formatCode(effects.rotate || "none"),
      "scale " + formatCode(effects.scale || "none"),
      "opacity " + formatCode(effects.opacity || "n/a"),
      "will-change " + formatCode(effects.willChange || "auto"),
      "contain " + formatCode(effects.contain || "none"),
      "isolation " + formatCode(effects.isolation || "auto"),
      "mix-blend-mode " + formatCode(effects.mixBlendMode || "normal"),
      "position " + formatCode(effects.position || "static") + (effects.isSticky ? " (sticky)" : ""),
      "data-sticky " + formatCode(effects.dataSticky === null ? "not present" : effects.dataSticky || "present"),
      "z-index " + formatCode(effects.zIndex || "auto"),
      "overflow " +
        formatCode(
          (overflow.all || "visible") +
            " / x " +
            (overflow.x || "visible") +
            " / y " +
            (overflow.y || "visible")
        ),
      "animation " +
        formatCode(
          [
            "name " + (animation.name || "none"),
            "duration " + (animation.duration || "0s"),
            "delay " + (animation.delay || "0s"),
            "fill " + (animation.fillMode || "none"),
            "play-state " + (animation.playState || "running"),
            "timing " + (animation.timingFunction || "ease")
          ].join(" | ")
        ),
      "transition " +
        formatCode(
          "property " +
            (transition.property || "all") +
            " | duration " +
            (transition.duration || "0s")
        )
    ].join(" | ");
  }

  function buildMarkdown(report) {
    var lines = [];

    lines.push("# DOMScout Targeting Report");
    lines.push("");
    lines.push("## Context");
    lines.push(
      "- Element identity: " +
        formatCode(report.meta.elementIdentity || report.selection.elementIdentity || "n/a") +
        " (same label DevTools shows when hovering with the element picker)"
    );
    lines.push("- Tool: " + formatCode(report.meta.tool + " v" + report.meta.version));
    lines.push("- Timestamp: " + formatCode(report.meta.timestamp));
    lines.push("- Document title: " + formatCode(report.document.title || "n/a"));
    lines.push("- Document URL: " + formatCode(report.document.url || "n/a"));
    lines.push("- Root type: " + formatCode(report.document.rootType));
    lines.push("- Local receiver URL: " + formatCode(report.meta.receiverSendUrl || "n/a"));
    if (report.document.shadowHostSelector) {
      lines.push("- Shadow host: " + formatCode(report.document.shadowHostSelector));
    }
    if (report.meta.note) {
      lines.push("- Selection note: " + report.meta.note);
    }
    if (report.context.rootNote) {
      lines.push("- Root warning: " + report.context.rootNote);
    }
    lines.push("");
    if (report.meta.warnings && report.meta.warnings.length) {
      lines.push("## Warnings");
      report.meta.warnings.forEach(function (warning) {
        lines.push("- " + warning);
      });
      lines.push("");
    }
    lines.push("## Selected Element");
    lines.push("- Element identity: " + formatCode(report.selection.elementIdentity || "n/a"));
    lines.push("- Headline: " + formatCode(report.selection.tagName + (report.selection.id ? "#" + report.selection.id : "")));
    lines.push("- Tag: " + formatCode(report.selection.tagName));
    lines.push("- Id: " + formatCode(report.selection.id || "n/a"));
    lines.push("- Classes: " + formatCode(report.selection.classList.join(" ") || "n/a"));
    lines.push("- Full class string: " + formatCode(report.selection.classString || "n/a"));
    lines.push("- Role: " + formatCode(report.selection.role || "n/a"));
    lines.push("- Title: " + formatCode(report.selection.title || "n/a"));
    lines.push("- Name: " + formatCode(report.selection.name || "n/a"));
    lines.push("- href/src: " + formatCode(report.selection.href || report.selection.src || "n/a"));
    lines.push("- Visible text summary: " + formatCode(report.selection.textSummary || "n/a"));
    lines.push("- Visible: " + formatCode(yesNo(report.selection.isVisible)));
    lines.push("- Clickable: " + formatCode(yesNo(report.selection.isClickable)));
    lines.push("- Connected to live document: " + formatCode(yesNo(report.selection.isConnected)));
    lines.push("- Focusable: " + formatCode(yesNo(report.selection.isFocusable)));
    lines.push("- Inside shadow root: " + formatCode(yesNo(report.selection.isInsideShadowRoot)));
    lines.push("- Attributes: " + (summarizeAttributes(report.selection.attributes, 10).map(formatCode).join(", ") || "`none`"));
    lines.push("- data-* attributes: " + (summarizeAttributes(report.selection.dataAttributes, 10).map(formatCode).join(", ") || "`none`"));
    lines.push("- aria-* attributes: " + (summarizeAttributes(report.selection.ariaAttributes, 10).map(formatCode).join(", ") || "`none`"));
    lines.push("");
    lines.push("## Selector Strategy");
    if (report.selectors.safestSelector) {
      lines.push(
        "- Safest selector: " +
          formatCode(report.selectors.safestSelector.selector) +
          " (" +
          report.selectors.safestSelector.reliability +
          ", matches " +
          report.selectors.safestSelector.matchCount +
          ")"
      );
    }
    if (report.selectors.shortSelector) {
      lines.push(
        "- Short selector: " +
          formatCode(report.selectors.shortSelector.selector) +
          " (" +
          report.selectors.shortSelector.reliability +
          ", matches " +
          report.selectors.shortSelector.matchCount +
          ")"
      );
    }
    if (report.selectors.fullDomPathSelector) {
      lines.push("- Full DOM path selector: " + formatCode(report.selectors.fullDomPathSelector.selector));
    }
    lines.push("- Ranked selectors:");
    report.selectors.ranked.slice(0, 8).forEach(function (candidate, index) {
      lines.push(
        "  " +
          (index + 1) +
          ". " +
          formatCode(candidate.selector) +
          " | reliability: " +
          candidate.reliability +
          " | matches: " +
          (candidate.matchCount == null ? "error" : candidate.matchCount) +
          (report.document.rootType === "shadow-root" && candidate.rootScopeMatchCount !== candidate.matchCount
            ? " | shadow-root matches: " + candidate.rootScopeMatchCount
            : "") +
          (candidate.warnings.length ? " | warnings: " + candidate.warnings.join("; ") : "")
      );
    });
    lines.push("- Attribute-based selectors: " + (report.selectors.attributeBasedSelectors.slice(0, 5).map(function (candidate) { return formatCode(candidate.selector); }).join(", ") || "`none`"));
    lines.push("- Class-based selectors: " + (report.selectors.classBasedSelectors.slice(0, 5).map(function (candidate) { return formatCode(candidate.selector); }).join(", ") || "`none`"));
    lines.push("- Parent + child selectors: " + (report.selectors.parentChildSelectors.slice(0, 5).map(function (candidate) { return formatCode(candidate.selector); }).join(", ") || "`none`"));
    lines.push("- Selector warnings: " + (report.selectors.warnings.length ? report.selectors.warnings.join("; ") : "none"));
    lines.push("");
    lines.push("## Ancestors");
    lines.push(
      "- Coverage: captured " +
        report.ancestorCoverage.capturedCount +
        " ancestor(s), stopped at " +
        report.ancestorCoverage.termination +
        " (limit " +
        report.ancestorCoverage.limit +
        ")."
    );
    if (report.ancestorCoverage.truncated) {
      lines.push(
        "- Truncation note: additional ancestors exist beyond this section. The full DOM path may include more nodes."
      );
    }
    if (report.ancestors.length) {
      report.ancestors.forEach(function (ancestor) {
        var details = [
          formatCode(ancestor.shortSelector),
          "depth " + ancestor.depth,
          ancestor.isLikelyContainer ? "likely container" : "not a strong container",
          ancestor.isClickable ? "clickable" : "not clickable",
          ancestor.dimensions.width + "x" + ancestor.dimensions.height
        ];
        if (ancestor.role) {
          details.push("role " + ancestor.role);
        }
        if (ancestor.note) {
          details.push(ancestor.note);
        }
        if (ancestor.signals.length) {
          details.push("signals: " + ancestor.signals.join("; "));
        }
        lines.push("- " + details.join(" | "));
        lines.push("  - Effect/compositing: " + formatEffectSnapshot(ancestor.effects));
        if (ancestor.unstableClasses.length) {
          lines.push(
            "  - Unstable class caution: " +
              ancestor.unstableClasses.map(formatCode).join(", ") +
              " look generated or hash-like; their computed effect state above is still useful."
          );
        }
        if (ancestor.effects.animations.error) {
          lines.push("  - Animation API note: " + ancestor.effects.animations.error);
        }
        ancestor.effects.animations.items.forEach(function (animation) {
          lines.push("  - Web Animation: " + formatAnimationSummary(animation));
        });
      });
    } else {
      lines.push("- No ancestor data available.");
    }
    lines.push("");
    lines.push("## Children And Descendants");
    lines.push(
      "- Immediate children: " +
        (report.children.immediateChildren.length
          ? report.children.immediateChildren
              .map(function (child) {
                return formatCode(child.selector) + (child.textSummary ? " (" + child.textSummary + ")" : "");
              })
              .join(", ")
          : "`none`")
    );
    lines.push(
      "- Direct text nodes: " +
        (report.children.directTextNodes.length
          ? report.children.directTextNodes.map(formatCode).join(", ")
          : "`none`")
    );
    lines.push(
      "- Useful descendants: " +
        (report.children.usefulDescendants.length
          ? report.children.usefulDescendants
              .map(function (descendant) {
                return formatCode(descendant.selector) + " (" + descendant.reason + ")";
              })
              .join(", ")
          : "`none`")
    );
    lines.push("");
    lines.push("## Layout And Visual");
    lines.push(
      "- Bounding rect: " +
        formatCode(
          "x " +
            report.layout.rect.x +
            ", y " +
            report.layout.rect.y +
            ", width " +
            report.layout.rect.width +
            ", height " +
            report.layout.rect.height
        )
    );
    lines.push("- Display: " + formatCode(report.layout.display || "n/a"));
    lines.push("- Position: " + formatCode(report.layout.position || "n/a"));
    lines.push("- z-index: " + formatCode(report.layout.zIndex || "n/a"));
    lines.push("- Overflow: " + formatCode(report.layout.overflow ? report.layout.overflow.all : "n/a"));
    lines.push("- Opacity: " + formatCode(report.layout.opacity || "n/a"));
    lines.push("- Visibility: " + formatCode(report.layout.visibility || "n/a"));
    lines.push("- Pointer events: " + formatCode(report.layout.pointerEvents || "n/a"));
    lines.push("- Margin: " + formatCode(report.layout.margin || "n/a"));
    lines.push("- Padding: " + formatCode(report.layout.padding || "n/a"));
    lines.push("- Border: " + formatCode(report.layout.border || "n/a"));
    lines.push("- Border radius: " + formatCode(report.layout.borderRadius || "n/a"));
    lines.push("- Background: " + formatCode(report.layout.background || "n/a"));
    lines.push("- Color: " + formatCode(report.layout.color || "n/a"));
    lines.push(
      "- Font: " +
        formatCode(
          report.layout.font
            ? [
                report.layout.font.size,
                report.layout.font.lineHeight,
                report.layout.font.weight,
                report.layout.font.family
              ].join(" / ")
            : "n/a"
        )
    );
    lines.push("- Box shadow: " + formatCode(report.layout.boxShadow || "n/a"));
    lines.push("- Transform: " + formatCode(report.layout.transform || "n/a") + " (" + report.layout.transformState + ")");
    lines.push("- Effect/compositing: " + formatEffectSnapshot(report.layout.effects));
    if (report.layout.animations.error) {
      lines.push("- Animation API note: " + report.layout.animations.error);
    }
    if (report.layout.animations.items.length) {
      lines.push("- Web Animations:");
      report.layout.animations.items.forEach(function (animation) {
        lines.push("  - " + formatAnimationSummary(animation));
      });
    } else {
      lines.push(
        "- Web Animations: " +
          (report.layout.animations.available ? "none returned for this element" : "getAnimations() is unavailable")
      );
    }
    lines.push("");
    lines.push("## Effect / Compositor Risk");
    if (report.insights.effectCompositorRisks.items.length) {
      report.insights.effectCompositorRisks.items.forEach(function (risk) {
        lines.push(
          "- " +
            formatCode(risk.node) +
            (risk.depth ? " (ancestor depth " + risk.depth + ")" : "") +
            ": " +
            risk.reason
        );
      });
      if (report.insights.effectCompositorRisks.truncated) {
        lines.push(
          "- " +
            (report.insights.effectCompositorRisks.total -
              report.insights.effectCompositorRisks.items.length) +
            " additional risk signal(s) were kept out of this small summary; inspect the ancestor effect snapshots above."
        );
      }
    } else {
      lines.push("- No high-signal effect/compositor conditions were detected in the captured chain.");
    }
    lines.push("");
    lines.push("## CSS Sources");
    lines.push(
      "- Property traces: " +
        (report.cssTrace.propertyTraces.length
          ? report.cssTrace.propertyTraces
              .map(function (trace) {
                return (
                  formatCode(trace.group) +
                  " -> " +
                  formatCode(trace.computedValue) +
                  " | source: " +
                  describeCssSource(trace.source) +
                  (trace.source ? " | declared as " + formatCode(trace.source.declaredValue) : "") +
                  (trace.variableChain.length
                    ? " | vars: " + trace.variableChain.map(summarizeVariableTrace).join("; ")
                    : "") +
                  (trace.note ? " | note: " + trace.note : "")
                );
              })
              .join("\n- ")
          : "none")
    );
    lines.push(
      "- Matched CSS rules: " +
        (report.cssTrace.matchedRules.length
          ? report.cssTrace.matchedRules
              .map(function (match) {
                return (
                  formatCode(match.selector) +
                  " | " +
                  match.source +
                  (match.context ? " | " + match.context : "") +
                  (match.declarations.length ? " | " + match.declarations.join("; ") : "")
                );
              })
              .join("\n- ")
          : "none")
    );
    lines.push(
      "- CSS variables seen: " +
        (report.cssTrace.variableTraces.length
          ? report.cssTrace.variableTraces.map(summarizeVariableTrace).join(", ")
          : "none")
    );
    lines.push(
      "- CSS trace notes: " +
        (report.cssTrace.notes.length ? report.cssTrace.notes.join("; ") : "none")
    );
    if (report.cssTrace.inaccessibleStyleSheets.length) {
      lines.push(
        "- Inaccessible stylesheets: " +
          report.cssTrace.inaccessibleStyleSheets.map(formatCode).join(", ")
      );
    }
    lines.push("");
    lines.push("## Context Guidance");
    if (report.context.scrollContainer) {
      lines.push("- Nearest scroll/container parent: " + formatCode(report.context.scrollContainer.selector));
    }
    if (report.context.nearestMeaningfulContainer) {
      lines.push("- Nearest meaningful named container: " + formatCode(report.context.nearestMeaningfulContainer.selector));
    }
    lines.push(
      "- Likely wrapper/card/container candidates: " +
        (report.insights.likelyContainerCandidates.length
          ? report.insights.likelyContainerCandidates.map(function (candidate) { return formatCode(candidate.selector); }).join(", ")
          : "`none`")
    );
    lines.push(
      "- Parent may be better to target when: " +
        (report.insights.betterParentTargets.length
          ? report.insights.betterParentTargets
              .map(function (item) {
                return formatCode(item.selector) + " -> " + item.reason;
              })
              .join(" | ")
          : "no strong parent-target recommendation")
    );
    lines.push(
      "- Child may be better to target when: " +
        (report.insights.betterChildTargets.length
          ? report.insights.betterChildTargets
              .map(function (item) {
                return formatCode(item.selector) + " -> " + item.reason;
              })
              .join(" | ")
          : "no strong child-target recommendation")
    );
    lines.push("- Notes: " + (report.insights.notes.length ? report.insights.notes.join("; ") : "none"));
    lines.push("");
    lines.push("## HTML Excerpt");
    lines.push("```html");
    lines.push(report.selection.outerHtmlExcerpt || "<no outerHTML available>");
    lines.push("```");

    return lines.join("\n");
  }

  function inferStoredGlobalName(element) {
    var names;

    try {
      names = Object.getOwnPropertyNames(global)
        .filter(function (name) {
          return /^temp\d+$/i.test(name);
        })
        .sort(function (left, right) {
          return Number(left.replace(/\D/g, "")) - Number(right.replace(/\D/g, ""));
        });
    } catch (error) {
      return null;
    }

    for (var index = 0; index < names.length; index += 1) {
      try {
        if (global[names[index]] === element) {
          return names[index];
        }
      } catch (error) {
        continue;
      }
    }

    return null;
  }

  function getStructuralIdentity(element) {
    var tagName = lower(element.tagName);
    var anchor = null;
    var anchorStrength = "fallback";
    var attributeName;
    var value;
    var index;

    if (element.id && isStableId(element.id)) {
      anchor = "id:" + element.id;
      anchorStrength = "strong";
    }

    if (!anchor) {
      for (index = 0; index < STABLE_DATA_ATTRS.length; index += 1) {
        attributeName = STABLE_DATA_ATTRS[index];
        value = normalizeWhitespace(element.getAttribute(attributeName));
        if (value) {
          anchor = attributeName + ":" + value;
          anchorStrength = "strong";
          break;
        }
      }
    }

    if (!anchor) {
      ["aria-label", "name", "role", "title"].some(function (name) {
        value = normalizeWhitespace(element.getAttribute(name));
        if (!value) {
          return false;
        }
        anchor = name + ":" + value;
        anchorStrength = name === "role" ? "semantic" : "strong";
        return true;
      });
    }

    if (!anchor) {
      var meaningfulClasses = getClassList(element).filter(isMeaningfulClassName).slice(0, 2);
      if (meaningfulClasses.length) {
        anchor = "class:" + meaningfulClasses.join(".");
        anchorStrength = "class";
      }
    }

    var nthOfType = getNthOfTypeIndex(element);
    var fallbackKey = tagName + "|nth-of-type:" + nthOfType;

    return {
      anchor: anchor,
      anchorStrength: anchorStrength,
      fallbackKey: fallbackKey,
      key: tagName + "|" + (anchor || "nth-of-type:" + nthOfType),
      nthOfType: nthOfType,
      tagName: tagName
    };
  }

  function buildComparisonNodeFromElement(element, depth, selected) {
    var effects = getEffectSnapshot(element);
    return {
      classList: getClassList(element),
      classString: normalizeWhitespace(element.className),
      depthFromSelection: depth,
      dimensions: getRectSnapshot(element),
      effects: effects,
      id: element.id || null,
      isSelected: !!selected,
      label: getBestLabel(element) || null,
      role: element.getAttribute("role") || null,
      shortSelector: buildQuickSelector(element),
      structure: getStructuralIdentity(element),
      tagName: lower(element.tagName),
      unstableClasses: getClassList(element).filter(isHashLike),
      usefulAttributes: getUsefulAttributes(element)
    };
  }

  function buildComparisonNodeFromAncestor(ancestor) {
    return {
      classList: ancestor.classList,
      classString: ancestor.classString,
      depthFromSelection: ancestor.depth,
      dimensions: ancestor.dimensions,
      effects: ancestor.effects,
      id: ancestor.id,
      isSelected: false,
      label: ancestor.label,
      role: ancestor.role,
      shortSelector: ancestor.shortSelector,
      structure: ancestor.structure,
      tagName: ancestor.tagName,
      unstableClasses: ancestor.unstableClasses,
      usefulAttributes: ancestor.usefulAttributes
    };
  }

  function buildComparisonCapture(element, label, source) {
    var ancestorContext = collectAncestors(element);
    var chain = ancestorContext.items
      .slice()
      .reverse()
      .map(buildComparisonNodeFromAncestor);

    chain.push(buildComparisonNodeFromElement(element, 0, true));

    return {
      chain: chain,
      coverage: ancestorContext.coverage,
      document: {
        title: global.document && global.document.title ? global.document.title : "",
        url: global.location && global.location.href ? global.location.href : ""
      },
      label: label,
      source: source || null,
      timestamp: new Date().toISOString()
    };
  }

  function nextMarkLabel() {
    var index = state.markOrder.length + 1;
    var candidate = "mark" + index;

    while (state.marks[candidate]) {
      index += 1;
      candidate = "mark" + index;
    }

    return candidate;
  }

  function markTarget(candidate, label) {
    var resolved = resolveTarget(candidate, arguments.length ? 1 : 0);
    var normalizedLabel = normalizeWhitespace(label);
    var inferredLabel;
    var capture;

    resolved = handleResolvedTarget(resolved, "mark");
    if (!resolved || resolved.matches) {
      return resolved;
    }

    inferredLabel = inferStoredGlobalName(resolved.element);
    normalizedLabel = normalizedLabel || inferredLabel || nextMarkLabel();
    capture = buildComparisonCapture(
      resolved.element,
      normalizedLabel,
      typeof candidate === "string" ? candidate : inferredLabel
    );

    if (!state.marks[normalizedLabel]) {
      state.markOrder.push(normalizedLabel);
    }

    state.marks[normalizedLabel] = {
      capture: capture,
      label: normalizedLabel,
      target: resolved.element
    };

    console.info(
      "[" +
        TOOL_NAME +
        "] Marked " +
        buildElementHeadline(resolved.element) +
        " as `" +
        normalizedLabel +
        "` with " +
        capture.chain.length +
        " structural path node(s)."
    );

    return capture;
  }

  function listMarks() {
    var marks = state.markOrder
      .filter(function (label) {
        return !!state.marks[label];
      })
      .map(function (label) {
        var record = state.marks[label];
        var target = record.target;
        return {
          connected: target ? !!target.isConnected : false,
          label: label,
          markedAt: record.capture.timestamp,
          selector:
            record.capture.chain.length
              ? record.capture.chain[record.capture.chain.length - 1].shortSelector
              : null,
          source: record.capture.source
        };
      });

    if (console.table) {
      console.table(marks);
    } else {
      console.log(marks);
    }

    return marks;
  }

  function resolveCompareInput(input, index) {
    var record;
    var resolved;
    var inferredLabel;

    if (typeof input === "string" && state.marks[input]) {
      record = state.marks[input];
      return record.capture;
    }

    resolved = resolveTarget(input, 1);
    if (resolved.error) {
      return {
        error: resolved.error
      };
    }

    inferredLabel =
      (typeof input === "string" && input !== "$0" ? input : null) ||
      inferStoredGlobalName(resolved.element) ||
      "state" + (index + 1);

    return buildComparisonCapture(resolved.element, inferredLabel, inferredLabel);
  }

  function nodesStructurallyMatch(left, right) {
    if (!left || !right || left.tagName !== right.tagName) {
      return false;
    }

    if (left.structure.key === right.structure.key) {
      return true;
    }

    if (left.structure.anchor || right.structure.anchor) {
      return false;
    }

    return left.structure.fallbackKey === right.structure.fallbackKey;
  }

  function alignStructuralChains(leftChain, rightChain) {
    var rowCount = leftChain.length + 1;
    var columnCount = rightChain.length + 1;
    var matrix = [];
    var row;
    var column;
    var aligned = [];

    for (row = 0; row < rowCount; row += 1) {
      matrix[row] = [];
      for (column = 0; column < columnCount; column += 1) {
        matrix[row][column] = 0;
      }
    }

    for (row = 1; row < rowCount; row += 1) {
      for (column = 1; column < columnCount; column += 1) {
        matrix[row][column] = nodesStructurallyMatch(leftChain[row - 1], rightChain[column - 1])
          ? matrix[row - 1][column - 1] + 1
          : Math.max(matrix[row - 1][column], matrix[row][column - 1]);
      }
    }

    row = leftChain.length;
    column = rightChain.length;

    while (row > 0 || column > 0) {
      if (
        row > 0 &&
        column > 0 &&
        nodesStructurallyMatch(leftChain[row - 1], rightChain[column - 1])
      ) {
        aligned.unshift({
          left: leftChain[row - 1],
          matchBasis: "stable-structure",
          right: rightChain[column - 1],
          status: "shared"
        });
        row -= 1;
        column -= 1;
      } else if (column > 0 && (row === 0 || matrix[row][column - 1] >= matrix[row - 1][column])) {
        aligned.unshift({
          left: null,
          right: rightChain[column - 1],
          status: "right-only"
        });
        column -= 1;
      } else {
        aligned.unshift({
          left: leftChain[row - 1],
          right: null,
          status: "left-only"
        });
        row -= 1;
      }
    }

    return aligned;
  }

  function getStructuralAnchorKind(node) {
    var anchor = node && node.structure ? node.structure.anchor : null;
    return anchor ? anchor.split(":")[0] : null;
  }

  function canCoalesceStructuralFallback(left, right) {
    var leftKind;
    var rightKind;
    var leftClasses;
    var rightClasses;

    if (
      !left ||
      !right ||
      left.tagName !== right.tagName ||
      left.isSelected !== right.isSelected ||
      left.structure.fallbackKey !== right.structure.fallbackKey
    ) {
      return false;
    }

    if (left.role && right.role && left.role !== right.role) {
      return false;
    }

    leftKind = getStructuralAnchorKind(left);
    rightKind = getStructuralAnchorKind(right);
    if (leftKind || rightKind) {
      if (leftKind !== rightKind) {
        return false;
      }
      if (leftKind === "class") {
        leftClasses = (left.classList || []).filter(isMeaningfulClassName);
        rightClasses = (right.classList || []).filter(isMeaningfulClassName);
        return leftClasses.some(function (className) {
          return rightClasses.indexOf(className) !== -1;
        });
      }
    }

    return true;
  }

  function coalesceStructuralFallbacks(rows) {
    var pairIndexes = {};
    var result = [];
    var index;
    var candidateIndex;
    var compatibleIndexes;

    for (index = 0; index < rows.length; index += 1) {
      if (rows[index].status === "shared" || typeof pairIndexes[index] !== "undefined") {
        continue;
      }

      compatibleIndexes = [];
      for (candidateIndex = index + 1; candidateIndex < rows.length; candidateIndex += 1) {
        if (rows[candidateIndex].status === "shared") {
          break;
        }
        if (
          rows[index].status === rows[candidateIndex].status ||
          typeof pairIndexes[candidateIndex] !== "undefined"
        ) {
          continue;
        }

        var left = rows[index].left || rows[candidateIndex].left;
        var right = rows[index].right || rows[candidateIndex].right;
        if (canCoalesceStructuralFallback(left, right)) {
          compatibleIndexes.push(candidateIndex);
        }
      }

      if (compatibleIndexes.length === 1) {
        pairIndexes[index] = compatibleIndexes[0];
        pairIndexes[compatibleIndexes[0]] = index;
      }
    }

    for (index = 0; index < rows.length; index += 1) {
      if (typeof pairIndexes[index] === "undefined") {
        result.push(rows[index]);
        continue;
      }
      if (pairIndexes[index] > index) {
        continue;
      }

      var pairedRow = rows[pairIndexes[index]];
      result.push({
        left: rows[index].left || pairedRow.left,
        matchBasis: "structural-fallback-after-anchor-change",
        right: rows[index].right || pairedRow.right,
        status: "shared"
      });
    }

    return result;
  }

  function summarizeAnimationsForCompare(animations) {
    return ((animations && animations.items) || []).map(function (animation) {
      var timing = animation.computedTiming || animation.timing || {};
      return [
        animation.type,
        animation.name || "unnamed",
        animation.playState,
        "finished=" + animation.finished,
        "fill=" + (animation.fill || "n/a"),
        "duration=" + (typeof timing.duration === "undefined" ? "n/a" : timing.duration),
        "delay=" + (typeof timing.delay === "undefined" ? "n/a" : timing.delay)
      ].join(" ");
    });
  }

  function getComparableNodeProperties(node) {
    var effects = node.effects || {};
    var animation = effects.animation || {};
    var overflow = effects.overflow || {};
    var transition = effects.transition || {};
    var dimensions = node.dimensions || {};

    return {
      "animation-delay": animation.delay,
      "animation-duration": animation.duration,
      "animation-fill-mode": animation.fillMode,
      "animation-name": animation.name,
      "animation-play-state": animation.playState,
      "animation-timing-function": animation.timingFunction,
      animations: summarizeAnimationsForCompare(effects.animations),
      attributes: node.usefulAttributes,
      "backdrop-filter": effects.backdropFilter,
      classes: node.classString,
      contain: effects.contain,
      "data-sticky": effects.dataSticky,
      filter: effects.filter,
      height: dimensions.height,
      isolation: effects.isolation,
      label: node.label,
      "mix-blend-mode": effects.mixBlendMode,
      opacity: effects.opacity,
      overflow: overflow.all,
      "overflow-x": overflow.x,
      "overflow-y": overflow.y,
      position: effects.position,
      rotate: effects.rotate,
      role: node.role,
      scale: effects.scale,
      sticky: effects.isSticky,
      transform: effects.transform,
      "transform-state": effects.transformState,
      "transition-duration": transition.duration,
      "transition-property": transition.property,
      translate: effects.translate,
      "-webkit-backdrop-filter": effects.webkitBackdropFilter,
      width: dimensions.width,
      "will-change": effects.willChange,
      "z-index": effects.zIndex
    };
  }

  function comparableValue(value) {
    if (typeof value === "undefined") {
      return null;
    }
    if (value && typeof value === "object") {
      try {
        return JSON.stringify(value);
      } catch (error) {
        return String(value);
      }
    }
    return value;
  }

  function diffComparableNodes(left, right) {
    var leftProperties = getComparableNodeProperties(left);
    var rightProperties = getComparableNodeProperties(right);
    var names = unique(Object.keys(leftProperties).concat(Object.keys(rightProperties))).sort();

    return names
      .filter(function (name) {
        return comparableValue(leftProperties[name]) !== comparableValue(rightProperties[name]);
      })
      .map(function (name) {
        return {
          left: leftProperties[name],
          property: name,
          right: rightProperties[name]
        };
      });
  }

  function buildPairComparison(leftCapture, rightCapture) {
    var rows = coalesceStructuralFallbacks(
      alignStructuralChains(leftCapture.chain, rightCapture.chain)
    );
    var changedSharedNodes = 0;

    rows.forEach(function (row) {
      row.deltas = row.status === "shared" ? diffComparableNodes(row.left, row.right) : [];
      if (row.deltas.length) {
        changedSharedNodes += 1;
      }
    });

    return {
      changedSharedNodes: changedSharedNodes,
      labels: [leftCapture.label, rightCapture.label],
      leftOnlyNodes: rows.filter(function (row) { return row.status === "left-only"; }).length,
      rightOnlyNodes: rows.filter(function (row) { return row.status === "right-only"; }).length,
      rows: rows,
      sharedNodes: rows.filter(function (row) { return row.status === "shared"; }).length
    };
  }

  function formatCompareValue(value) {
    if (value == null || value === "") {
      return "n/a";
    }
    if (typeof value === "object") {
      try {
        return JSON.stringify(value);
      } catch (error) {
        return String(value);
      }
    }
    return String(value);
  }

  function buildCompareMarkdown(comparison) {
    var lines = ["# DOMScout State Comparison", ""];

    lines.push(
      "- States: " +
        comparison.states.map(function (capture) {
          return formatCode(capture.label) + " (" + capture.timestamp + ")";
        }).join(", ")
    );
    lines.push(
      "- Structural note: ancestry is aligned by stable DOM signals and fallback structural positions, not live node identity."
    );
    lines.push(
      "- Ancestor coverage: " +
        comparison.states.map(function (capture) {
          return (
            capture.label +
            " captured " +
            capture.coverage.capturedCount +
            " ancestor(s), stopped at " +
            capture.coverage.termination +
            (capture.coverage.truncated ? " (truncated)" : "")
          );
        }).join("; ") +
        "."
    );
    if (
      comparison.states.some(function (capture) {
        return capture.coverage.truncated;
      })
    ) {
      lines.push(
        "- Truncation warning: at least one comparison state has ancestors beyond the capture limit, so structural counts describe only the captured path."
      );
    }
    lines.push("");

    comparison.pairs.forEach(function (pair) {
      var leftLabel = pair.labels[0];
      var rightLabel = pair.labels[1];
      lines.push("## " + escapeMarkdown(leftLabel) + " vs " + escapeMarkdown(rightLabel));
      lines.push(
        "- Shared path nodes: " +
          pair.sharedNodes +
          "; changed shared nodes: " +
          pair.changedSharedNodes +
          "; only in " +
          leftLabel +
          ": " +
          pair.leftOnlyNodes +
          "; only in " +
          rightLabel +
          ": " +
          pair.rightOnlyNodes +
          "."
      );

      pair.rows.forEach(function (row) {
        var node;
        if (row.status === "left-only") {
          lines.push(
            "- Only in " + leftLabel + ": " + formatCode(row.left.shortSelector) + " (" + row.left.structure.key + ")"
          );
          return;
        }
        if (row.status === "right-only") {
          lines.push(
            "- Only in " + rightLabel + ": " + formatCode(row.right.shortSelector) + " (" + row.right.structure.key + ")"
          );
          return;
        }
        if (!row.deltas.length) {
          return;
        }

        node = row.left.shortSelector + " ↔ " + row.right.shortSelector;
        lines.push(
          "- Shared " +
            formatCode(node) +
            (row.matchBasis === "structural-fallback-after-anchor-change"
              ? " (aligned by structural fallback after identifying signals changed)"
              : "") +
            ":"
        );
        row.deltas.forEach(function (delta) {
          lines.push(
            "  - " +
              formatCode(delta.property) +
              ": " +
              formatCode(formatCompareValue(delta.left)) +
              " → " +
              formatCode(formatCompareValue(delta.right))
          );
        });
      });

      if (!pair.changedSharedNodes && !pair.leftOnlyNodes && !pair.rightOnlyNodes) {
        lines.push("- No structural or captured property differences were found.");
      }
      lines.push("");
    });

    return lines.join("\n");
  }

  function compareStates() {
    var inputs = Array.prototype.slice.call(arguments);
    var captures;
    var pairs = [];

    if (inputs.length < 2) {
      console.warn("[" + TOOL_NAME + "] DOMScout.compare() expects at least two mark labels or elements.");
      return null;
    }

    captures = inputs.map(resolveCompareInput);
    var failed = captures.find(function (capture) {
      return !!capture.error;
    });
    if (failed) {
      console.warn("[" + TOOL_NAME + "] " + failed.error);
      return null;
    }

    for (var leftIndex = 0; leftIndex < captures.length - 1; leftIndex += 1) {
      for (var rightIndex = leftIndex + 1; rightIndex < captures.length; rightIndex += 1) {
        pairs.push(buildPairComparison(captures[leftIndex], captures[rightIndex]));
      }
    }

    var comparison = {
      meta: {
        timestamp: new Date().toISOString(),
        tool: TOOL_NAME,
        version: VERSION
      },
      pairs: pairs,
      states: captures
    };
    var markdown = buildCompareMarkdown(comparison);

    state.lastCompare = comparison;
    state.lastCompareMarkdown = markdown;
    console.log(markdown);
    if (console.groupCollapsed) {
      console.groupCollapsed("[" + TOOL_NAME + "] Structured state comparison");
      console.dir(comparison);
      console.groupEnd();
    }

    return comparison;
  }

  function copyText(text) {
    try {
      if (typeof global.copy === "function") {
        global.copy(text);
        return Promise.resolve({
          method: "devtools-copy",
          ok: true
        });
      }
    } catch (error) {
      return Promise.resolve({
        method: "devtools-copy",
        ok: false,
        reason: error && error.message ? error.message : String(error)
      });
    }

    if (global.navigator && global.navigator.clipboard && typeof global.navigator.clipboard.writeText === "function") {
      return global.navigator.clipboard
        .writeText(text)
        .then(function () {
          return {
            method: "navigator.clipboard",
            ok: true
          };
        })
        .catch(function (error) {
          return {
            method: "navigator.clipboard",
            ok: false,
            reason: error && error.message ? error.message : String(error)
          };
        });
    }

    try {
      var textarea = global.document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "readonly");
      textarea.style.position = "fixed";
      textarea.style.top = "-1000px";
      global.document.body.appendChild(textarea);
      textarea.select();
      var success = global.document.execCommand("copy");
      global.document.body.removeChild(textarea);
      return Promise.resolve({
        method: "execCommand",
        ok: !!success
      });
    } catch (error) {
      return Promise.resolve({
        method: "execCommand",
        ok: false,
        reason: error && error.message ? error.message : String(error)
      });
    }
  }

  function logReport(markdown, report) {
    console.info("[" + TOOL_NAME + "] Report ready. Markdown is printed below. Structured data is available in DOMScout.lastReport.");
    console.log(markdown);

    if (console.groupCollapsed) {
      console.groupCollapsed("[" + TOOL_NAME + "] Structured report object");
      console.dir(report);
      console.groupEnd();
      return;
    }

    console.log(report);
  }

  function normalizeFormat(format, defaultValue) {
    var value = lower(format || defaultValue || "markdown");

    if (value === "md" || value === "markdown") {
      return "markdown";
    }
    if (value === "json") {
      return "json";
    }

    return defaultValue || "markdown";
  }

  function isFormatToken(value) {
    if (typeof value !== "string") {
      return false;
    }

    var token = lower(normalizeWhitespace(value));
    return token === "md" || token === "markdown" || token === "json";
  }

  function waitMs(ms) {
    return new Promise(function (resolve) {
      global.setTimeout(resolve, ms);
    });
  }

  function collectBuiltReports(inputs, actionName) {
    var builtReports = [];
    var matchLists = [];
    var index;
    var resolved;
    var report;

    for (index = 0; index < inputs.length; index += 1) {
      resolved = handleResolvedTarget(resolveTarget(inputs[index], 1), actionName);
      if (!resolved) {
        continue;
      }
      if (resolved.matches) {
        matchLists.push(resolved);
        continue;
      }
      report = buildReport(resolved.element, resolved.note);
      builtReports.push({
        element: resolved.element,
        markdown: buildMarkdown(report),
        report: report
      });
    }

    return {
      builtReports: builtReports,
      matchLists: matchLists
    };
  }

  function getCachedReportUnits() {
    if (state.lastBuiltReports && state.lastBuiltReports.length) {
      return state.lastBuiltReports;
    }

    if (!state.lastReport) {
      return [];
    }

    return [
      {
        element: state.lastTarget,
        markdown: state.lastMarkdown,
        report: state.lastReport
      }
    ];
  }

  function unitExportContent(unit, format) {
    if (format === "json") {
      return safeJson(unit.report);
    }

    return unit.markdown;
  }

  function parseJsonSafely(text) {
    try {
      return text ? JSON.parse(text) : null;
    } catch (error) {
      return null;
    }
  }

  function postJson(url, payload) {
    if (typeof global.fetch === "function") {
      var controller = typeof global.AbortController === "function" ? new global.AbortController() : null;
      var timeoutId = null;

      if (controller) {
        timeoutId = global.setTimeout(function () {
          controller.abort();
        }, RECEIVER_TIMEOUT_MS);
      }

      return global
        .fetch(url, {
          body: JSON.stringify(payload),
          cache: "no-store",
          credentials: "omit",
          headers: {
            "Content-Type": "application/json",
            "X-DOMScout-Tool": TOOL_NAME
          },
          method: "POST",
          mode: "cors",
          signal: controller ? controller.signal : void 0
        })
        .then(function (response) {
          return response.text().then(function (text) {
            if (timeoutId) {
              global.clearTimeout(timeoutId);
            }

            return {
              json: parseJsonSafely(text),
              ok: response.ok,
              status: response.status,
              text: text
            };
          });
        })
        .catch(function (error) {
          if (timeoutId) {
            global.clearTimeout(timeoutId);
          }
          throw error;
        });
    }

    return new Promise(function (resolve, reject) {
      var xhr = new global.XMLHttpRequest();
      var timeoutId = global.setTimeout(function () {
        xhr.abort();
        reject(new Error("Timed out sending report to the local receiver."));
      }, RECEIVER_TIMEOUT_MS);

      xhr.open("POST", url, true);
      xhr.setRequestHeader("Content-Type", "application/json");
      xhr.setRequestHeader("X-DOMScout-Tool", TOOL_NAME);
      xhr.onreadystatechange = function () {
        if (xhr.readyState !== 4) {
          return;
        }

        global.clearTimeout(timeoutId);
        resolve({
          json: parseJsonSafely(xhr.responseText),
          ok: xhr.status >= 200 && xhr.status < 300,
          status: xhr.status,
          text: xhr.responseText
        });
      };
      xhr.onerror = function () {
        global.clearTimeout(timeoutId);
        reject(new Error("Failed to reach the local receiver."));
      };
      xhr.send(JSON.stringify(payload));
    });
  }

  function sendOneUnit(unit, sendUrl) {
    var payload = {
      document: {
        title: unit.report.document ? unit.report.document.title : "",
        url: unit.report.document ? unit.report.document.url : "",
        userAgent: global.navigator && global.navigator.userAgent ? global.navigator.userAgent : ""
      },
      json: safeJson(unit.report),
      markdown: unit.markdown,
      report: unit.report
    };

    return postJson(sendUrl, payload).then(function (response) {
      var savedPaths = response.json && response.json.paths ? response.json.paths : null;
      var result = {
        ok: response.ok,
        paths: savedPaths,
        status: response.status,
        timestamp: new Date().toISOString(),
        url: sendUrl
      };

      unit.report.meta.lastSend = result;

      if (!response.ok) {
        console.warn(
          "[" +
            TOOL_NAME +
            "] Local receiver responded with HTTP " +
            response.status +
            "." +
            (response.text ? " " + truncate(response.text, 220) : "")
        );
        return result;
      }

      console.info(
        "[" +
          TOOL_NAME +
          "] Local receiver saved the report." +
          (unit.report.meta && unit.report.meta.elementIdentity ? " " + unit.report.meta.elementIdentity + "." : "") +
          (savedPaths && savedPaths.markdownPath ? " Markdown: " + savedPaths.markdownPath : "") +
          (savedPaths && savedPaths.jsonPath ? " JSON: " + savedPaths.jsonPath : "")
      );
      return result;
    });
  }

  function sendReport() {
    var inputs = Array.prototype.slice.call(arguments);
    var sendUrl = getReceiverSendUrl();
    var collected;
    var units;

    if (inputs.length) {
      collected = collectBuiltReports(inputs, "send");
      units = collected.builtReports;
      if (!units.length) {
        console.warn("[" + TOOL_NAME + "] No sendable target resolved. Pass a $0, stored global, selector, or #N pick.");
        return Promise.resolve(false);
      }
    } else {
      units = getCachedReportUnits();
      if (!units.length) {
        console.warn("[" + TOOL_NAME + "] No cached report is available. Run DOMScout.inspect() first.");
        return Promise.resolve(false);
      }
    }

    return units
      .reduce(function (chain, unit) {
        return chain.then(function (results) {
          return sendOneUnit(unit, sendUrl).then(function (result) {
            results.push(result);
            return results;
          });
        });
      }, Promise.resolve([]))
      .then(function (results) {
        var ok = results.every(function (item) {
          return item.ok;
        });

        state.lastSendResult =
          results.length === 1
            ? results[0]
            : {
                count: results.length,
                ok: ok,
                results: results,
                timestamp: new Date().toISOString(),
                url: sendUrl
              };

        if (state.lastReport && units.length === 1 && units[0].report === state.lastReport) {
          state.lastReport.meta.lastSend = results[0];
          state.lastJson = safeJson(state.lastReport);
        }

        return ok;
      })
      .catch(function (error) {
        state.lastSendResult = {
          ok: false,
          status: null,
          timestamp: new Date().toISOString(),
          url: sendUrl
        };
        if (state.lastReport) {
          state.lastReport.meta.lastSend = state.lastSendResult;
          state.lastJson = safeJson(state.lastReport);
        }

        console.warn(
          "[" +
            TOOL_NAME +
            "] Failed to reach the local receiver at " +
            sendUrl +
            ". Start `domscout.receiver.js` first." +
            (error && error.message ? " (" + error.message + ")" : "")
        );
        return false;
      });
  }

  function cancelPause() {
    if (state.lastPauseTimer) {
      global.clearTimeout(state.lastPauseTimer);
      state.lastPauseTimer = null;
      console.info("[" + TOOL_NAME + "] Cleared the pending debugger pause.");
      return true;
    }

    return false;
  }

  function pauseInspection(delayMs) {
    var delay = normalizeDelay(delayMs, 4000);
    cancelPause();

    state.lastPauseTimer = global.setTimeout(function () {
      state.lastPauseTimer = null;
      debugger;
    }, delay);

    console.info(
      "[" +
        TOOL_NAME +
        "] Debugger pause scheduled in " +
        delay +
        "ms. Trigger or hover the target now, and DevTools will pause execution automatically."
    );
    return delay;
  }

  function disposeInstance() {
    cancelPause();
    state.lastJson = "";
    state.lastMarkdown = "";
    state.lastCompare = null;
    state.lastCompareMarkdown = "";
    state.lastReport = null;
    state.lastSendResult = null;
    state.lastTarget = null;
    state.lastBuiltReports = [];
    state.lastSelectorMatches = null;
    state.markOrder = [];
    state.marks = Object.create(null);
    clearHighlight();
  }

  function clearHighlight() {
    if (state.highlightTimer) {
      global.clearTimeout(state.highlightTimer);
      state.highlightTimer = null;
    }

    (state.highlightOverlays || []).forEach(function (overlay) {
      if (overlay && overlay.parentNode) {
        try {
          overlay.parentNode.removeChild(overlay);
        } catch (error) {
          // Overlay may already have been removed with the page.
        }
      }
    });

    state.highlightOverlays = [];
    return true;
  }

  function createHighlightOverlay(element) {
    var rect;
    var overlay;
    var host;

    if (!element || element.nodeType !== 1) {
      return null;
    }

    rect = getRectSnapshot(element);
    if (!global.document || typeof global.document.createElement !== "function") {
      return true;
    }

    overlay = global.document.createElement("div");
    overlay.setAttribute("data-domscout-highlight", "true");
    overlay.style.position = "fixed";
    overlay.style.left = rect.left + "px";
    overlay.style.top = rect.top + "px";
    overlay.style.width = Math.max(rect.width, 2) + "px";
    overlay.style.height = Math.max(rect.height, 2) + "px";
    overlay.style.background = HIGHLIGHT_FILL;
    overlay.style.outline = HIGHLIGHT_OUTLINE;
    overlay.style.boxShadow = "0 0 0 1px rgba(255, 255, 255, 0.45), 0 0 18px rgba(176, 64, 255, 0.55)";
    overlay.style.pointerEvents = "none";
    overlay.style.zIndex = "2147483647";
    overlay.style.borderRadius = "2px";

    host = global.document.documentElement || global.document.body;
    if (!host) {
      return true;
    }

    host.appendChild(overlay);
    return overlay;
  }

  function applyHighlights(elements) {
    var uniqueElements = [];
    var created = 0;

    clearHighlight();

    (elements || []).forEach(function (element) {
      if (!element || element.nodeType !== 1 || uniqueElements.indexOf(element) !== -1) {
        return;
      }
      uniqueElements.push(element);
    });

    if (!uniqueElements.length) {
      return 0;
    }

    try {
      if (typeof uniqueElements[0].scrollIntoView === "function") {
        uniqueElements[0].scrollIntoView({
          block: "center",
          inline: "nearest"
        });
      }
    } catch (error) {
      try {
        uniqueElements[0].scrollIntoView();
      } catch (scrollError) {
        // Ignore scroll failures and still try to paint overlays.
      }
    }

    uniqueElements.forEach(function (element) {
      var overlay = createHighlightOverlay(element);
      if (overlay && overlay !== true) {
        state.highlightOverlays.push(overlay);
        created += 1;
      } else if (overlay === true) {
        created += 1;
      }
    });

    if (created) {
      state.highlightTimer = global.setTimeout(function () {
        clearHighlight();
      }, HIGHLIGHT_MS);
    }

    return created;
  }

  function applyHighlight(element) {
    return applyHighlights([element]) > 0;
  }

  function handleResolvedTarget(resolved, actionName) {
    if (resolved.error) {
      console.warn("[" + TOOL_NAME + "] " + resolved.error);
      return null;
    }

    if (resolved.matches) {
      printSelectorMatchList(resolved.matches);
      return resolved.matches;
    }

    if (!resolved.element) {
      console.warn("[" + TOOL_NAME + "] No element was resolved for " + actionName + ".");
      return null;
    }

    return resolved;
  }

  function printHelpMenu() {
    var helpText = [
      "[" + TOOL_NAME + " v" + VERSION + "] Ready for Chromium/Electron/WebView DevTools.",
      "",
      "Commands:",
      "  DOMScout.help() - Show this help menu.",
      "  DOMScout.inspect() - Inspect the current $0 selection.",
      "  DOMScout.inspect(temp1_or_element) - Inspect a stored global element or explicit DOM node.",
      "  DOMScout.inspect('selector_or_class') - Search by CSS selector or class name.",
      "  DOMScout.inspect('#1') - Inspect ranked match #1 from the latest selector search. Quotes are required.",
      "  DOMScout.inspect(target1, target2, ...) - Inspect several targets in one call.",
      "  DOMScout.test() - Temporarily highlight the current $0 selection in bright purple.",
      "  DOMScout.test(temp1_or_selector_or_#1) - Highlight a stored global, selector match, or ranked pick.",
      "  DOMScout.test(target1, target2, ...) - Highlight several targets at once.",
      "  DOMScout.mark('$0', 'label') - Snapshot the current $0 and its ancestry under a label.",
      "  DOMScout.mark(temp1) - Snapshot a stored global; its temp name becomes the label when detectable.",
      "  DOMScout.marks() - List stored comparison marks.",
      "  DOMScout.compare('state1', 'state2', ...) - Structurally compare two or more marks.",
      "  DOMScout.compare(temp1, temp2) - Compare stored elements directly without marking first.",
      "  DOMScout.copy() - Copy the last report as Markdown.",
      "  DOMScout.copy('md') or DOMScout.copy('markdown') - Same Markdown copy, explicit format.",
      "  DOMScout.copy('json') - Copy the last report as JSON.",
      "  DOMScout.copy(target1, target2, ...) - Copy each target as a separate clipboard entry, last one stays on paste.",
      "  DOMScout.send() - Save the last report to the local receiver as its own file pair.",
      "  DOMScout.send(target1, target2, ...) - Save each target as a separate Markdown + JSON pair.",
      "  DOMScout.pause(delay_ms_optional) - Pause execution after 4000ms by default, or a custom delay.",
      "  DOMScout.cancelPause() - Cancel a pending scheduled pause.",
      "  DOMScout.clear() - Clear cached state and redraw this menu.",
      "  DOMScout.version - Current version string.",
      "",
      "Workflow:",
      "  1. Use the picker to set $0, store a global, or pass a CSS selector / class name.",
      "  2. Run DOMScout.inspect(), DOMScout.inspect(temp1), or DOMScout.inspect('.class-name').",
      "  3. If several elements match, pick the latest ranked list with DOMScout.inspect('#1'). Quotes are required.",
      "  4. inspect(), test(), send(), and copy() accept several targets in one call, for example DOMScout.test('temp2', '#1', '$0').",
      "  5. Run DOMScout.test(...) to confirm the target with a temporary bright purple highlight.",
      "  6. Run DOMScout.send() to POST reports to the local receiver.",
      "  Compare: mark separate UI states manually, then run DOMScout.compare('state1', 'state2').",
      "  Tip: DOMScout.pause() is a built-in shortcut for setTimeout(() => { debugger; }, 4000).",
      "",
      "Receiver:",
      "  Send URL: " + getReceiverSendUrl(),
      "  Health URL: " + getReceiverHealthUrl()
    ].join("\n");

    console.log(helpText);
    return helpText;
  }

  function finishInspectReports(builtReports) {
    var report;
    var markdown;
    var identities;

    if (!builtReports.length) {
      return null;
    }

    if (builtReports.length === 1) {
      report = builtReports[0].report;
      markdown = builtReports[0].markdown;
    } else {
      identities = builtReports.map(function (item) {
        return item.report.meta.elementIdentity;
      });
      report = {
        document: builtReports[0].report.document,
        meta: {
          autoCopy: "pending",
          count: builtReports.length,
          elementIdentity: identities.join(" | "),
          lastSend: null,
          multiInspect: true,
          timestamp: new Date().toISOString(),
          tool: TOOL_NAME,
          version: VERSION,
          warnings: []
        },
        reports: builtReports.map(function (item) {
          return item.report;
        }),
        selection: builtReports[builtReports.length - 1].report.selection
      };
      markdown = builtReports
        .map(function (item, index) {
          return "<!-- DOMScout report " + (index + 1) + " of " + builtReports.length + " -->\n" + item.markdown;
        })
        .join("\n\n---\n\n");
    }

    state.lastReport = report;
    state.lastMarkdown = markdown;
    state.lastJson = safeJson(report);
    state.lastSendResult = null;
    state.lastTarget = builtReports[builtReports.length - 1].element;
    state.lastBuiltReports = builtReports;

    logReport(markdown, report);
    builtReports.forEach(function (item) {
      (item.report.meta.warnings || []).forEach(function (warning) {
        console.warn("[" + TOOL_NAME + "] " + warning);
      });
    });

    copyText(markdown).then(function (result) {
      if (!state.lastReport) {
        return;
      }

      state.lastReport.meta.autoCopy = result.ok ? "copied via " + result.method : "blocked";
      state.lastJson = safeJson(state.lastReport);

      if (result.ok) {
        console.info("[" + TOOL_NAME + "] Markdown report copied to the clipboard via " + result.method + ".");
      } else {
        console.warn(
          "[" +
            TOOL_NAME +
            "] Auto-copy was blocked. Use DOMScout.copy() manually if needed." +
            (result.reason ? " (" + result.reason + ")" : "")
        );
      }
    });

    return builtReports.length === 1 ? builtReports[0].report : report;
  }

  function inspect() {
    var inputs = Array.prototype.slice.call(arguments);
    var collected;
    var resolved;

    if (!inputs.length) {
      resolved = handleResolvedTarget(resolveTarget(undefined, 0), "inspect");
      if (!resolved) {
        printHelpMenu();
        return null;
      }
      if (resolved.matches) {
        return resolved;
      }
      var emptyArgReport = buildReport(resolved.element, resolved.note);
      return finishInspectReports([
        {
          element: resolved.element,
          markdown: buildMarkdown(emptyArgReport),
          report: emptyArgReport
        }
      ]);
    }

    collected = collectBuiltReports(inputs, "inspect");

    if (!collected.builtReports.length) {
      return collected.matchLists.length === 1
        ? collected.matchLists[0]
        : collected.matchLists.length
          ? collected.matchLists
          : null;
    }

    return finishInspectReports(collected.builtReports);
  }

  function testTarget() {
    var inputs = Array.prototype.slice.call(arguments);
    var elements = [];
    var matchLists = [];
    var index;
    var resolved;
    var highlighted;

    if (!inputs.length) {
      resolved = handleResolvedTarget(resolveTarget(undefined, 0), "test");
      if (!resolved) {
        return null;
      }
      if (resolved.matches) {
        return resolved;
      }
      elements.push(resolved.element);
    } else {
      for (index = 0; index < inputs.length; index += 1) {
        resolved = handleResolvedTarget(resolveTarget(inputs[index], 1), "test");
        if (!resolved) {
          continue;
        }
        if (resolved.matches) {
          matchLists.push(resolved);
          continue;
        }
        if (elements.indexOf(resolved.element) === -1) {
          elements.push(resolved.element);
        }
      }
    }

    if (!elements.length) {
      return matchLists.length === 1 ? matchLists[0] : matchLists.length ? matchLists : null;
    }

    highlighted = applyHighlights(elements);
    if (!highlighted) {
      console.warn("[" + TOOL_NAME + "] Could not highlight the resolved element(s).");
      return null;
    }

    state.lastTarget = elements[elements.length - 1];
    console.info(
      "[" +
        TOOL_NAME +
        "] Highlighting " +
        elements
          .map(function (element) {
            return buildDevtoolsIdentity(element);
          })
          .join(", ") +
        " with a temporary bright purple overlay."
    );

    return elements.length === 1 ? elements[0] : elements;
  }

  function copyReport() {
    var inputs = Array.prototype.slice.call(arguments);
    var format = "markdown";
    var targets = inputs;
    var collected;
    var units;

    if (inputs.length && isFormatToken(inputs[0])) {
      format = normalizeFormat(inputs[0], "markdown");
      targets = inputs.slice(1);
    }

    if (targets.length) {
      collected = collectBuiltReports(targets, "copy");
      units = collected.builtReports;
    } else {
      units = getCachedReportUnits();
    }

    if (!units.length) {
      console.warn("[" + TOOL_NAME + "] No cached report is available. Run DOMScout.inspect() first.");
      return Promise.resolve(false);
    }

    return units
      .reduce(function (chain, unit, index) {
        return chain.then(function (okSoFar) {
          var writeUnit = function () {
            return copyText(unitExportContent(unit, format)).then(function (result) {
              if (!result.ok) {
                console.warn(
                  "[" +
                    TOOL_NAME +
                    "] Clipboard copy failed." +
                    (result.reason ? " (" + result.reason + ")" : "")
                );
                return false;
              }

              if (units.length > 1) {
                console.info(
                  "[" +
                    TOOL_NAME +
                    "] Copied " +
                    format +
                    " report " +
                    (index + 1) +
                    " of " +
                    units.length +
                    (unit.report.meta && unit.report.meta.elementIdentity
                      ? " (" + unit.report.meta.elementIdentity + ")"
                      : "") +
                    "."
                );
              }

              return okSoFar;
            });
          };

          if (index === 0) {
            return writeUnit();
          }

          return waitMs(COPY_SEQUENCE_DELAY_MS).then(writeUnit);
        });
      }, Promise.resolve(true))
      .then(function (ok) {
        if (!ok) {
          return false;
        }

        if (units.length === 1) {
          console.info("[" + TOOL_NAME + "] Copied " + format + " report to the clipboard.");
        } else {
          console.info(
            "[" +
              TOOL_NAME +
              "] Copied " +
              units.length +
              " " +
              format +
              " reports as separate clipboard entries. The last one is current paste; earlier ones may appear in clipboard history."
          );
        }

        return true;
      });
  }

  function clearState() {
    cancelPause();
    state.lastJson = "";
    state.lastMarkdown = "";
    state.lastCompare = null;
    state.lastCompareMarkdown = "";
    state.lastReport = null;
    state.lastSendResult = null;
    state.lastTarget = null;
    state.lastBuiltReports = [];
    state.lastSelectorMatches = null;
    state.markOrder = [];
    state.marks = Object.create(null);
    clearHighlight();

    if (typeof console.clear === "function") {
      console.clear();
    }

    printHelpMenu();
    return true;
  }

  var api = {
    _dispose: disposeInstance,
    cancelPause: cancelPause,
    clear: clearState,
    compare: compareStates,
    copy: copyReport,
    help: printHelpMenu,
    inspect: inspect,
    mark: markTarget,
    marks: listMarks,
    pause: pauseInspection,
    send: sendReport,
    test: testTarget,
    version: VERSION,
    get lastJson() {
      return state.lastJson;
    },
    get lastMarkdown() {
      return state.lastMarkdown;
    },
    get lastCompare() {
      return state.lastCompare;
    },
    get lastCompareMarkdown() {
      return state.lastCompareMarkdown;
    },
    get lastReport() {
      return state.lastReport;
    },
    get lastSendResult() {
      return state.lastSendResult;
    },
    get lastSelectorMatches() {
      return state.lastSelectorMatches;
    }
  };

  if (global.DOMScout && typeof global.DOMScout._dispose === "function") {
    global.DOMScout._dispose();
  }

  global.DOMScout = api;
  printHelpMenu();
})(typeof globalThis !== "undefined" ? globalThis : window);
