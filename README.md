# DOMScout

A DevTools helper for Chromium, Electron, and WebView. You pick a DOM node the normal way, then DOMScout turns it into a targeting report: selectors, ancestry, layout, CSS traces, animations, and the ancestor effect/compositor state that makes a “correct” computed style still paint wrong.

Works in Chrome, Edge, Electron DevTools, and Chromium WebViews. Native UI (Win32, WPF, Qt, and so on) is out unless the app actually exposes a DOM.

## Setup

1. Open DevTools → **Sources** → **Snippets**.
2. New snippet, paste `domscout.js`, save it.
3. Run that snippet once per DevTools session.

## Creating & Saving Reports

1. If you saved the snippet, run it. Otherwise, just paste the DOMScout script from `domscout.js` into console.
2. In Chrome DevTools select your targeted element from the Elements tab, optionally save it as a global variable.
3. Use `DOMScout.inspect()` with `$0`, a saved global variable name, or a class/selector name in the parentheses.
4. Use `DOMScout.copy()` to copy to your clipboard. To export, start the receiver with `node domscout.receiver.js` in your terminal, or use `helpers/linux-start-receiver.desktop` or `helpers/win-start-receiver.bat`. Then just `DOMScout.send()` to export into `reports/<folder>/` as `.json` and `.md`. The folder name is the element identity split on separators (`.`, `-`, `_`), kept to the first three chunks, e.g. `div.composer-human-message-content` → `div-composer-human`. 

## Info

### Targeting

Most commands take a target the same three ways:

1. `$0` — the current Elements picker selection. `.inspect()` with no args uses this; but of course you can still use `DOMScout.inspect($0)`
2. **A stored global or live node** — right-click the element → Store as global variable, then use the variable name, like `DOMScout.inspect(temp1)`.
3. **A class or selector name** — `DOMScout.inspect('class-or-selector-name')`. If more than one node matches, you get a ranked list first. Pick from it with `DOMScout.inspect('#1')`.

Leave `()` empty on `inspect()`, `test()`, and `mark()` to use the current `$0` picker selection. Leave `copy()` and `send()` empty to reuse the last report.

#### Use several targets at once 
`.inspect`, `.test`, `.send`, `.copy`, and of course `.compare` support multiple targets in one call:

- `DOMScout.inspect(temp1, '#1', '$0')`
- `DOMScout.test('temp2', '#1', '$0')`
- `DOMScout.send(temp1, temp2)`
- `DOMScout.copy('md', 'temp1', 'temp2')`
- `DOMScout.compare('$0', temp1, temp2)` 

### Compare two (or more) states

Use `.mark` to snapshot, then `.compare` them, for example with targeting by `$0`:

```js
DOMScout.mark('$0', 'state1'); // can use whatever custom mark name you like (e.g. 'state1')
// pick another node or re-pick the previous $0
DOMScout.mark('$0', 'state2');
DOMScout.compare('state1', 'state2');
```

Using `.mark` is mainly useful for `$0` as the targets, you can skip marks and compare stored nodes directly like: `.compare(temp1, temp2)`. Alignment is structural, so a remount still shows wrappers that exist in only one state and property deltas on the shared path.

### What’s in a report
- Element identity (`tag.class`, the same hover label the picker shows)
- Ranked selector candidates and warnings
- Up to 32 ancestors (the report says when the chain was truncated)
- Children / descendants, layout, CSS rule and variable traces
- Effect/compositing snapshot on the selection and those ancestors: transform (including identity matrices), translate/rotate/scale, filter, backdrop-filter, animation, `will-change`, contain, isolation, sticky/`data-sticky`, overflow, stacking
- Element-local CSS animations, transitions, and Web Animations when `getAnimations()` is available
- A short Effect / Compositor Risk list, but note that it's not a diagnosis. The selected node can look fine while an ancestor transform, animation, sticky context, or filter changes the pixels.
- Shadow DOM and disconnected-node warnings when those show up

Hash-like classes are still useful as evidence even when they are a bad selector.

### Alerts

If detections are made, they show up in the report and some in the console as well like Shadow DOMs and a detached stored node. Selector quality notes, ancestor truncation, unread stylesheets, and compositor-risk flags stay in the report so the console isn't noisy. 

- Shadow DOM — document-scope selectors and match counts can be misleading
- Stored global pointing at a detached / remounted node
- Selector looks too broad, hash-like, nth-based, or uses a likely-dynamic id
- Ancestor chain hit the 32-level cap
- Stylesheets that could not be read (usually cross-origin)
- Effect / compositor risk flags (ancestor transform, filter, sticky, animation, and similar)


### Limits
Cross-origin iframes, closed shadow roots, and cross-origin stylesheets can hide information.


## Commands

| Command                         |                                                                                                                                                                                                                               |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DOMScout.help()`               | Print help.                                                                                                                                                                                                                   |
| `DOMScout.inspect(...)`         | Build the targeting report.                                                                                                                                                                                                   |
| `DOMScout.test(...)`            | Flash a bright purple overlay to confirm you grabbed the right node. No args uses `$0`.                                                                                           |
| `DOMScout.mark(target, label?)` | Snapshot the node and its ancestry. A detectable `temp1`-style global can skip the label; that name is used instead.                                                                                                          |
| `DOMScout.marks()`              | List marks in this session.                                                                                                                                                                                                   |
| `DOMScout.compare(...)`         | Compare two or more marks, or live nodes (`temp1`, `temp2`, …). Alignment is structural, not object identity.                                                                                                                 |
| `DOMScout.copy(...)`            | Copy the last report. Default is Markdown; `'md'` / `'markdown'` are the same, `'json'` is JSON. Several targets become separate clipboard writes (last one is current paste; earlier ones may show up in clipboard history). |
| `DOMScout.send(...)`            | POST to the local receiver and write a `.md` + `.json` pair per report. No args sends whatever `inspect` last built.                                                                                                          |
| `DOMScout.pause(ms?)`           | `debugger` after 4000ms by default. Hover or trigger the UI, then inspect the frozen state.                                                                                                                                   |
| `DOMScout.cancelPause()`        | Cancel a pending pause.                                                                                                                                                                                                       |
| `DOMScout.clear()`              | Drop cached state and reprint help.                                                                                                                                                                                           |
| `DOMScout.version`              | Version string.                                                                                                                                                                                                               |