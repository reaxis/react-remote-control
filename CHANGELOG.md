# Changelog

All notable changes to this project will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.0] - 2026-11-03

### Added
- First release: a React 19 port of svelte-remote-control 0.3.0, wire-compatible
  with it (same messages and storage keys).
- `<RemoteControl />` with the same props (`remoteHref`, `config`, `connection`),
  UI and fallback for browsers without the Popover API. Its styles come with it
  (`rc-` prefixed classes in a React 19 hoisted `<style>`).
- Hooks: `useRcState` (like `useState`, synced), `useConnection`,
  `useConnStatus`, `useOnMessage`, `useOnCall`.
- `WebRTCConnection.subscribe()` / `getSnapshot()`, in place of Svelte's
  reactive fields (which remain as read-only getters).
- An attempt replaced by a newer `createOffer()` / `acceptOffer()` or by
  `destroy()` while it is still starting now stops and rejects with
  `type: 'superseded'`, instead of creating a second `Peer`. React's
  StrictMode starts, destroys and restarts the connection at once.
