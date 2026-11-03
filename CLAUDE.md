# Agent instructions: react-remote-control

After any change (new files, logic, dependencies, decisions, gotchas), update this file in the same change.

## Scope

React 19 port of [svelte-remote-control](https://github.com/reaxis/svelte-remote-control) 0.3.0: a WebRTC connection primitive (PeerJS), a drop-in `<RemoteControl />` UI and synced state hooks, published to npm as `react-remote-control`. The playground in `playground/` is the demo app; keep app-specific logic out of `src/`.

The core (`webrtc.ts`, most of `rcState.ts`) is a **deliberate copy** of the Svelte package's, not shared, for now. When fixing a bug in it, check whether svelte-remote-control has the same bug, and say so.

**Stay wire-compatible with svelte-remote-control:** same message types (`__sync`, `__sync_delete`, `__kick`), payload shapes and storage keys (`rc:state`, `rc:hostPeerId`). The two playgrounds connect to each other; test that after protocol changes.

## File layout

| File | Responsibility |
|---|---|
| `src/webrtc.ts` | `WebRTCConnection`: PeerJS transport. State is one immutable `ConnectionState` snapshot with `subscribe()` / `getSnapshot()` (for `useSyncExternalStore`) and read-only getters (`status`, `role`, …). Framework-free. |
| `src/rcState.ts` | Module-level singleton `connection`, the synced value store, `__sync` wiring, and the non-hook API (`rcState`, `deleteRcState`, `send`, `onMessage`, `onCall`, `makeCall`, `startCall`, `connStatus`). Framework-free. |
| `src/hooks.ts` | `'use client'`. `useRcState`, `useConnection`, `useConnStatus`, `useOnMessage`, `useOnCall`. |
| `src/RemoteControl.tsx` | `'use client'`. The UI component. |
| `src/styles.ts` | The component's CSS as a string. |
| `src/index.ts` | Package entry: default export `RemoteControl`, plus everything public. |
| `src/*.test.ts(x)` | Vitest + jsdom + Testing Library. `RemoteControl.strict.test.tsx` runs the real core under `<StrictMode>` with PeerJS mocked. |
| `test/setup.ts` | Testing Library cleanup (test globals are off, so it isn't automatic). |
| `playground/` | Vite app (`vite.config.ts` has `root: 'playground'`), imports the package through an alias to `src/index.ts`. Built to `build/`. |

Package build: `tsc -p tsconfig.build.json` → `dist/` (ESM + `.d.ts`, no bundler; `'use client'` directives survive). `@internal` exports are stripped from the `.d.ts`.

## Key decisions

- **Snapshot store instead of `$state`.** `#set(patch)` replaces the snapshot only when a field changes (arrays compared item by item), then notifies. Values in `rcState.ts` work the same way: `_values` is replaced, never mutated.
- **Superseded attempts (`#epoch`).** `#cleanup()` bumps `#epoch`; `createOffer` / `acceptOffer` remember theirs and stop with `SupersededError` (`type: 'superseded'`) once it changes: before creating the `Peer`, after it opens, and before an accepted connection counts. A superseded attempt never touches the state. Needed for StrictMode (start → destroy → start at once), which otherwise created two Peers with the same saved ID. Fixed the same way in svelte-remote-control (unreleased after 0.3.0). Also `destroy()` while a Peer opens: PeerJS emits `'close'`, not `'error'`, so `#createPeer` listens for it too.
- **`useRcState` registers the key during render** (`ensureKey`: sets `initial` / drops an invalid stored value, without notifying). Server snapshot is `initial`, so hydration matches. Setter accepts an updater function, like `useState`. Only the first `initial` counts.
- **`rcState()` kept** as a non-hook accessor (`{ value }`) for code outside components.
- **`useOnMessage` / `useOnCall` keep the latest handler in a ref** (updated in a layout effect) and subscribe once per connection. `useEffectEvent` would be nicer but needs React 19.2; the peer range is `^19.0.0`.
- **Component:** `connection` prop captured once (`useState` initializer). `clientId` (`?id=`) is read in the mount effect, not during render, so SSR and hydration render the same. Popover support comes from `useSyncExternalStore` with server snapshot `false`. The popover `id` comes from `useId()` (the Svelte version hardcodes `conn-popover`).
- **Effects run in declaration order**, so the `configure(config)` effect sits before the mount effect: the first attempt already uses `config`.
- **Styles:** `<style href="react-remote-control" precedence="default">` — React 19 hoists it into `<head>` once, also when server rendering. All classes are `rc-` prefixed (no scoping). `.rc-btn.rc-btn-sm` is a compound selector: in the Svelte version `.btn-sm` lost to `.btn` (same specificity, later rule), so its small buttons weren't small (since fixed there too).
- **Message types stay `Record<string, unknown>`**, as in the Svelte package.

## Gotchas (from the shared core; see svelte-remote-control's CLAUDE.md for the full history)

- `localPeerId` is cleared on `destroy()`. Handler sets survive `destroy()` by design (module-level wiring in `rcState.ts` is never unsubscribed).
- `acceptOffer` / `#createPeer` remove their listeners on settle; don't simplify to bare `.once()`s.
- Chrome never reports ICE `'failed'` through PeerJS; `#watchIce` watches `connectionState` too and rejects `acceptOffer` with `errorType` `'no-route'`. A host that never answers rejects after 10 s with `'peer-unavailable'`.
- `kick()` only sends `__kick`; the receiving `<RemoteControl />` disconnects itself.
- `beforeunload` closes DataConnections so the other side notices at once.
- `iceServers` can be a function, re-run every hour while a Peer lives.
- One effect throwing during mount can take unrelated components down with it on old Safari; feature-detect newer APIs (as with the Popover API).

## Testing

- `npm test` (Vitest, jsdom), `npm run check` (tsc for `src/` and `playground/`), `npm run prepack` (build + publint).
- Mocks: `vi.mock` factories run before declarations, so shared mock state goes in `vi.hoisted()`. Constructors mocked with `vi.fn` need `function () {}`, not arrows.
- jsdom has no Popover API, so component tests exercise the fallback; real popover behaviour (light dismiss, `onToggle`) is checked with Playwright on the playground.

## Publishing

Not published yet. Repo: `github.com/reaxis/react-remote-control` (`origin`, branch `main`), with CI in `.github/workflows/ci.yml`. Release pattern as svelte-remote-control: fix commit + CHANGELOG under `## [Unreleased]`, then a `Release x.y.z` commit (`npm version x.y.z --no-git-tag-version`, dated heading) and tag `vx.y.z`.
