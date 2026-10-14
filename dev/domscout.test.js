"use strict";

const assert = require("assert");

class FakeElement {
  constructor(tagName, options = {}) {
    this.nodeType = 1;
    this.tagName = tagName.toUpperCase();
    this.id = options.id || "";
    this.className = options.className || "";
    this.classList = this.className ? this.className.split(/\s+/) : [];
    this._attributes = { ...(options.attributes || {}) };
    if (this.id) this._attributes.id = this.id;
    if (this.className) this._attributes.class = this.className;
    this.attributes = Object.entries(this._attributes).map(([name, value]) => ({ name, value }));
    this.parentElement = null;
    this.children = [];
    this.childNodes = [];
    this.childElementCount = 0;
    this.hidden = false;
    this.isConnected = true;
    this.isContentEditable = false;
    this.onclick = null;
    this.scrollHeight = 100;
    this.scrollWidth = 100;
    this.clientHeight = 100;
    this.clientWidth = 100;
    this.style = {
      length: 0,
      getPropertyPriority() {
        return "";
      },
      getPropertyValue() {
        return "";
      }
    };
    this._computed = createComputed(options.computed || {});
    this._animations = options.animations || [];
    this._rect = options.rect || { x: 0, y: 0, width: 100, height: 40 };
  }

  append(child) {
    child.parentElement = this;
    this.children.push(child);
    this.childNodes.push(child);
    this.childElementCount = this.children.length;
    return child;
  }

  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this._attributes, name) ? this._attributes[name] : null;
  }

  hasAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this._attributes, name);
  }

  getAnimations() {
    return this._animations;
  }

  getBoundingClientRect() {
    const { x, y, width, height } = this._rect;
    return {
      bottom: y + height,
      height,
      left: x,
      right: x + width,
      top: y,
      width,
      x,
      y
    };
  }

  getRootNode() {
    return global.document;
  }

  matches() {
    return false;
  }
}

function createComputed(overrides) {
  const defaults = {
    "animation-delay": "0s",
    "animation-duration": "0s",
    "animation-fill-mode": "none",
    "animation-name": "none",
    "animation-play-state": "running",
    "animation-timing-function": "ease",
    "backdrop-filter": "none",
    "-webkit-backdrop-filter": "none",
    contain: "none",
    display: "block",
    filter: "none",
    isolation: "auto",
    "mix-blend-mode": "normal",
    opacity: "1",
    overflow: "visible",
    "overflow-x": "visible",
    "overflow-y": "visible",
    position: "static",
    rotate: "none",
    scale: "none",
    transform: "none",
    "transition-duration": "0s",
    "transition-property": "all",
    translate: "none",
    "will-change": "auto",
    "z-index": "auto"
  };
  const values = { ...defaults, ...overrides };
  const computed = {
    background: "rgba(0, 0, 0, 0)",
    backgroundColor: "rgba(0, 0, 0, 0)",
    border: "0px none",
    borderRadius: "0px",
    boxShadow: "none",
    color: "rgb(0, 0, 0)",
    cursor: "auto",
    fontFamily: "sans-serif",
    fontLineHeight: "normal",
    fontSize: "16px",
    fontStyle: "normal",
    fontWeight: "400",
    lineHeight: "normal",
    margin: "0px",
    padding: "0px",
    pointerEvents: "auto",
    visibility: "visible",
    getPropertyValue(name) {
      return values[name] || "";
    }
  };

  Object.entries(values).forEach(([name, value]) => {
    const camelName = name.replace(/^-webkit-/, "webkit-").replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    computed[camelName] = value;
  });

  return computed;
}

function fakeAnimation(name, playState, fill) {
  return {
    animationName: name,
    currentTime: 1000,
    effect: {
      getComputedTiming() {
        return {
          activeDuration: 1000,
          currentIteration: playState === "finished" ? null : 0,
          delay: 0,
          direction: "normal",
          duration: 1000,
          easing: "linear",
          endDelay: 0,
          endTime: 1000,
          fill,
          iterationStart: 0,
          iterations: 1,
          localTime: 1000,
          progress: playState === "finished" ? null : 1
        };
      },
      getTiming() {
        return {
          delay: 0,
          direction: "normal",
          duration: 1000,
          easing: "linear",
          endDelay: 0,
          fill,
          iterationStart: 0,
          iterations: 1
        };
      },
      pseudoElement: null
    },
    id: "",
    pending: false,
    playState,
    startTime: 0,
    timeline: { constructor: { name: "DocumentTimeline" } }
  };
}

global.CSS = { escape: (value) => String(value) };
global.CSSAnimation = function CSSAnimation() {};
global.NodeFilter = { SHOW_ELEMENT: 1 };
global.ShadowRoot = class ShadowRoot {};
global.copy = () => {};
global.location = { href: "https://example.test/" };
Object.defineProperty(global, "navigator", {
  configurable: true,
  value: {}
});
global.document = {
  adoptedStyleSheets: [],
  body: { appendChild() {}, removeChild() {} },
  createTreeWalker() {
    return { nextNode: () => null };
  },
  querySelectorAll() {
    return [];
  },
  styleSheets: [],
  title: "DOMScout test"
};
global.getComputedStyle = (element) => element._computed;

const html = new FakeElement("html");
const body = html.append(new FakeElement("body", { computed: { translate: "0px" } }));
const brokenWrapper = body.append(
  new FakeElement("div", {
    className: "panel-wrapper",
    computed: {
      "animation-name": "settle",
      transform: "matrix(1, 0, 0, 1, 0, 0)",
      "will-change": "transform"
    },
    animations: [fakeAnimation("settle", "finished", "forwards")]
  })
);
const brokenTarget = brokenWrapper.append(
  new FakeElement("span", {
    className: "paint-target",
    computed: { "backdrop-filter": "blur(12px)" }
  })
);

global.$0 = brokenTarget;
require("./domscout.js");

const report = global.DOMScout.inspect("$0");
assert.strictEqual(report.ancestorCoverage.limit, 32);
assert.strictEqual(report.meta.elementIdentity, "span.paint-target");
assert.strictEqual(report.selection.elementIdentity, "span.paint-target");
assert.strictEqual(report.layout.backdropFilter, "blur(12px)");
assert.strictEqual(report.ancestors[0].effects.transformIsIdentityMatrix, true);
assert.strictEqual(report.ancestors[0].effects.animations.items[0].finishedWithFillEffect, true);
assert.strictEqual(report.ancestors[1].effects.transformState, "identity individual transform (still creates a transformed context)");
assert.ok(report.insights.effectCompositorRisks.total >= 3);

global.DOMScout.mark("$0", "broken");

const fixedWrapper = body.append(
  new FakeElement("div", {
    className: "panel-wrapper",
    computed: { transform: "none", "will-change": "auto" }
  })
);
const transientWrapper = fixedWrapper.append(new FakeElement("div", { className: "transient-shell" }));
const fixedTarget = transientWrapper.append(new FakeElement("span", { className: "paint-target" }));
global.$0 = fixedTarget;
global.DOMScout.mark("$0", "fixed");

const comparison = global.DOMScout.compare("broken", "fixed");
assert.strictEqual(comparison.states.length, 2);
assert.strictEqual(comparison.pairs.length, 1);
assert.ok(comparison.pairs[0].rightOnlyNodes >= 1);
assert.ok(
  comparison.pairs[0].rows.some(
    (row) =>
      row.status === "shared" &&
      row.left.shortSelector === "div.panel-wrapper" &&
      row.right.shortSelector === "div.panel-wrapper" &&
      row.deltas.some((delta) => delta.property === "transform")
  )
);
assert.ok(
  comparison.pairs[0].rows.some(
    (row) => row.status === "right-only" && row.right.shortSelector === "div.transient-shell"
  )
);
global.temp1 = brokenTarget;
assert.strictEqual(global.DOMScout.mark(global.temp1).label, "temp1");
assert.deepStrictEqual(
  global.DOMScout.marks().map((mark) => mark.label),
  ["broken", "fixed", "temp1"]
);
global.temp2 = brokenTarget;
global.temp3 = fixedTarget;
assert.strictEqual(global.DOMScout.compare("temp2", "temp3").pairs.length, 1);
assert.strictEqual(global.DOMScout.compare("broken", "fixed", "temp1").pairs.length, 3);

const oldRoot = new FakeElement("section");
const oldLabelTarget = oldRoot.append(
  new FakeElement("button", { attributes: { "aria-label": "Old label" } })
);
const newRoot = new FakeElement("section");
const newLabelTarget = newRoot.append(
  new FakeElement("button", { attributes: { "aria-label": "New label" } })
);
const changedAnchorComparison = global.DOMScout.compare(oldLabelTarget, newLabelTarget);
assert.ok(
  changedAnchorComparison.pairs[0].rows.some(
    (row) =>
      row.status === "shared" &&
      row.left.tagName === "button" &&
      row.matchBasis === "structural-fallback-after-anchor-change" &&
      row.deltas.some((delta) => delta.property === "attributes")
  )
);

const oldCombinedRoot = new FakeElement("section");
const oldCombinedAncestor = oldCombinedRoot.append(
  new FakeElement("div", { attributes: { "data-testid": "old-ancestor" } })
);
const oldCombinedTarget = oldCombinedAncestor.append(
  new FakeElement("span", { className: "combined-target" })
);
const newCombinedRoot = new FakeElement("section");
const insertedCombinedWrapper = newCombinedRoot.append(
  new FakeElement("div", { className: "transient-shell" })
);
const newCombinedAncestor = insertedCombinedWrapper.append(
  new FakeElement("div", { attributes: { "data-testid": "new-ancestor" } })
);
const newCombinedTarget = newCombinedAncestor.append(
  new FakeElement("span", { className: "combined-target" })
);
const combinedComparison = global.DOMScout.compare(oldCombinedTarget, newCombinedTarget);
assert.ok(
  combinedComparison.pairs[0].rows.some(
    (row) =>
      row.status === "shared" &&
      row.left.usefulAttributes["data-testid"] === "old-ancestor" &&
      row.right.usefulAttributes["data-testid"] === "new-ancestor"
  )
);
assert.ok(
  combinedComparison.pairs[0].rows.some(
    (row) => row.status === "right-only" && row.right.shortSelector === "div.transient-shell"
  )
);

const ambiguousOldRoot = new FakeElement("section");
const ambiguousOldAncestor = ambiguousOldRoot.append(
  new FakeElement("div", { className: "panel old" })
);
const ambiguousOldTarget = ambiguousOldAncestor.append(
  new FakeElement("span", { className: "ambiguous-target" })
);
const ambiguousNewRoot = new FakeElement("section");
const ambiguousInsertedWrapper = ambiguousNewRoot.append(
  new FakeElement("div", { className: "panel shell" })
);
const ambiguousNewAncestor = ambiguousInsertedWrapper.append(
  new FakeElement("div", { className: "panel new" })
);
const ambiguousNewTarget = ambiguousNewAncestor.append(
  new FakeElement("span", { className: "ambiguous-target" })
);
const ambiguousComparison = global.DOMScout.compare(ambiguousOldTarget, ambiguousNewTarget);
assert.ok(
  !ambiguousComparison.pairs[0].rows.some(
    (row) =>
      row.status === "shared" &&
      row.left.shortSelector === "div.panel.old" &&
      row.right.shortSelector === "div.panel.shell"
  )
);

let deepTarget = new FakeElement("span", { className: "deep-target" });
for (let depth = 0; depth < 35; depth += 1) {
  const parent = new FakeElement("div");
  parent.append(deepTarget);
  deepTarget = parent;
}
const deepestSelection = (() => {
  let current = deepTarget;
  while (current.children.length) current = current.children[0];
  return current;
})();
assert.strictEqual(global.DOMScout.mark(deepestSelection, "deep").coverage.truncated, true);
global.DOMScout.compare("deep", "fixed");
assert.ok(global.DOMScout.lastCompareMarkdown.includes("Truncation warning"));

brokenTarget._attributes["aria-label"] = "Main paint";
brokenTarget.attributes.push({ name: "aria-label", value: "Main paint" });
const hiddenPaint = body.append(
  new FakeElement("span", {
    className: "paint-target",
    computed: { display: "none", visibility: "hidden", opacity: "0" },
    rect: { x: 0, y: 0, width: 900, height: 900 }
  })
);
global.document.querySelectorAll = (selector) => {
  if (selector === ".paint-target" || selector === "span.paint-target") {
    return [hiddenPaint, fixedTarget, brokenTarget];
  }
  return [];
};

const rankedMatches = global.DOMScout.inspect(".paint-target");
assert.strictEqual(rankedMatches.matches.length, 3);
assert.strictEqual(rankedMatches.matches[0].index, 1);
assert.strictEqual(rankedMatches.matches[0].element, brokenTarget);

const picked = global.DOMScout.inspect("#1");
assert.strictEqual(picked.selection.tagName, "span");
assert.strictEqual(picked.selection.ariaAttributes["aria-label"], "Main paint");

const pickedByNumber = global.DOMScout.inspect(1);
assert.strictEqual(pickedByNumber.selection.ariaAttributes["aria-label"], "Main paint");

const classNameSearch = global.DOMScout.inspect("paint-target");
assert.strictEqual(classNameSearch.matches[0].element, brokenTarget);

const highlighted = global.DOMScout.test("#1");
assert.strictEqual(highlighted, brokenTarget);

const multiInspect = global.DOMScout.inspect(brokenTarget, fixedTarget);
assert.strictEqual(multiInspect.meta.multiInspect, true);
assert.strictEqual(multiInspect.reports.length, 2);
assert.ok(multiInspect.meta.elementIdentity.indexOf("span.paint-target") !== -1);

const multiHighlight = global.DOMScout.test(brokenTarget, fixedTarget);
assert.strictEqual(multiHighlight.length, 2);

const copied = [];
global.copy = (text) => {
  copied.push(text);
};

const help = global.DOMScout.help();
assert.ok(help.indexOf("copy('md')") !== -1);
assert.ok(help.indexOf("DOMScout.send(target1, target2") !== -1);

global.DOMScout.inspect(brokenTarget, fixedTarget);
copied.length = 0;

global.DOMScout
  .copy("md")
  .then((ok) => {
    assert.strictEqual(ok, true);
    assert.strictEqual(copied.length, 2);
    assert.ok(copied[0].indexOf("span.paint-target") !== -1);
    assert.notStrictEqual(copied[0], copied[1]);
    return global.DOMScout.copy("json");
  })
  .then((ok) => {
    assert.strictEqual(ok, true);
    assert.strictEqual(copied.length, 4);
    JSON.parse(copied[copied.length - 1]);
    const posts = [];
    global.fetch = (url, options) => {
      posts.push(JSON.parse(options.body));
      return Promise.resolve({
        ok: true,
        status: 200,
        text() {
          return Promise.resolve(
            JSON.stringify({
              paths: { markdownPath: "a.md", jsonPath: "a.json" }
            })
          );
        }
      });
    };
    return global.DOMScout.send().then((sendOk) => {
      assert.strictEqual(sendOk, true);
      assert.strictEqual(posts.length, 2);
      assert.ok(!posts[0].report.meta.multiInspect);
      return global.DOMScout.send(brokenTarget, fixedTarget).then((directSendOk) => {
        assert.strictEqual(directSendOk, true);
        assert.strictEqual(posts.length, 4);
      });
    });
  })
  .then(() => {
    console.log("DOMScout tests passed.");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
