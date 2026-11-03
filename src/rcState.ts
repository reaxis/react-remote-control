/**
 * rcState — module-level singleton wiring over WebRTCConnection, plus the
 * synced key/value store behind `useRcState()` / `rcState()`.
 *
 * Framework-free: React reads the store through the hooks in `hooks.ts`.
 *
 * ## Sync semantics
 *
 * Values are **last-write-wins (LWW)** without causal ordering:
 * - Every write broadcasts a `__sync` message to all connected peers.
 * - Receivers accept the new value unconditionally and rebroadcast it to their
 *   other peers (the sender is excluded to prevent echo).
 * - Concurrent writes from different peers **silently overwrite** each other;
 *   the order of arrival on each peer determines the final value, so peers
 *   may temporarily disagree until the network settles.
 * - On peer connect, the whole value map is flushed to the new peer. In a
 *   star topology (clients ↔ host) this is exactly one pass per new client.
 *
 * Suitable for UI state (slider positions, toggles, form inputs) where
 * occasional lost updates are tolerable. **Not** suitable for counters,
 * shopping carts, or anything requiring convergence under concurrent edits.
 *
 * Keys can be deleted via `deleteRcState(key)` — deletion is broadcast and
 * also LWW.
 *
 * The wire protocol (`__sync`, `__sync_delete`, `__kick`) and the storage keys
 * match svelte-remote-control's, so the two can connect to each other.
 */

import { WebRTCConnection } from './webrtc.js';

type SyncMsg = { type: '__sync'; key: string; value: unknown };
type DeleteMsg = { type: '__sync_delete'; key: string };

// ── Module-level connection singleton ─────────────────────────────────────

export const connection = new WebRTCConnection();

// ── Value store ───────────────────────────────────────────────────────────

// Replaced, never mutated, so a value's identity only changes when it does.
let _values: Record<string, unknown> = {};
const _listeners = new Set<() => void>();

const STORAGE_KEY = 'rc:state';
if (typeof sessionStorage !== 'undefined') {
	try {
		const stored = sessionStorage.getItem(STORAGE_KEY);
		if (stored) _values = { ...JSON.parse(stored) };
	} catch {
		/* ignore malformed persisted state */
	}
}

function persistValues(): void {
	if (typeof sessionStorage === 'undefined') return;
	try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(_values)); } catch { /* ignore */ }
}

function writeValue(key: string, value: unknown): void {
	_values = { ..._values, [key]: value };
	persistValues();
	for (const listener of _listeners) listener();
}

function removeValue(key: string): void {
	const { [key]: _removed, ...rest } = _values;
	_values = rest;
	persistValues();
	for (const listener of _listeners) listener();
}

/** @internal For `useRcState`: call `listener` after any value changes. */
export function subscribeValues(listener: () => void): () => void {
	_listeners.add(listener);
	return () => { _listeners.delete(listener); };
}

/** @internal For `useRcState`: the current value of `key`. */
export function readValue(key: string): unknown {
	return _values[key];
}

// Per-key validators registered via rcState()'s third arg. Used to drop
// invalid incoming `__sync` payloads before they corrupt local state.
const _validators = new Map<string, (v: unknown) => boolean>();

/**
 * @internal Register `key` with its initial value and validator: a missing
 * value (or a stored one that fails `validate`) becomes `initial`. Doesn't
 * notify listeners, so it is safe to call while React renders; `initial` is
 * what they'd render for a missing key anyway.
 */
export function ensureKey<T>(key: string, initial: T, validate?: (v: unknown) => v is T): void {
	if (validate) _validators.set(key, validate);
	const invalid = validate && key in _values && !validate(_values[key]);
	if (!invalid && key in _values) return;
	_values = { ..._values, [key]: initial };
	persistValues();
}

/** @internal Set `key` locally and broadcast it. */
export function setValue(key: string, value: unknown): void {
	writeValue(key, value);
	if (connection.status === 'connected') {
		connection.send({ type: '__sync', key, value });
	}
}

// ── Wire sync handlers ────────────────────────────────────────────────────
// These handlers are registered once at module init and intentionally never
// unsubscribed — they live for the lifetime of the singleton `connection`.
// `connection.destroy()` wipes live DataConnections but preserves the class's
// handler sets by design, so the wiring below survives reconnects.

function isSyncMsg(msg: Record<string, unknown>): msg is SyncMsg {
	return msg.type === '__sync' && 'key' in msg && 'value' in msg
		&& typeof msg.key === 'string';
}

function isDeleteMsg(msg: Record<string, unknown>): msg is DeleteMsg {
	return msg.type === '__sync_delete' && 'key' in msg
		&& typeof msg.key === 'string';
}

function rebroadcast(msg: Record<string, unknown>, fromPeerId: string): void {
	for (const peerId of connection.connectedPeers) {
		if (peerId !== fromPeerId) connection.sendTo(peerId, msg);
	}
}

connection.onMessage((msg, fromPeerId) => {
	if (isSyncMsg(msg)) {
		const validate = _validators.get(msg.key);
		if (validate && !validate(msg.value)) {
			console.warn(`rcState: dropping invalid __sync for "${msg.key}"`, msg.value);
			return;
		}
		// Idempotency guard: if the incoming value matches what we already have,
		// drop the rebroadcast to prevent N-peer amplification (a delete or write
		// echoing back through the star topology).
		if (msg.key in _values && Object.is(_values[msg.key], msg.value)) return;
		writeValue(msg.key, msg.value);
		rebroadcast(msg, fromPeerId);
	} else if (isDeleteMsg(msg)) {
		if (!(msg.key in _values)) return; // already gone — don't echo
		removeValue(msg.key);
		rebroadcast(msg, fromPeerId);
	}
});

connection.onPeerConnect((peerId) => {
	for (const key of Object.keys(_values)) {
		connection.sendTo(peerId, { type: '__sync', key, value: _values[key] });
	}
});

// ── Public API ────────────────────────────────────────────────────────────

/**
 * A synced value, for code outside React components (event handlers in plain
 * modules, timers, tests). Inside a component, use `useRcState()`, which
 * also re-renders when the value changes.
 *
 * See the module docstring for sync semantics (last-write-wins, no causal
 * ordering, suitable for UI state).
 *
 * @param key    Unique key across all peers.
 * @param initial Default value if no value is already stored or synced.
 * @param validate Optional type-guard. If supplied:
 *   - Persisted values that fail validation are replaced with `initial`
 *     (protects against schema changes between sessions).
 *   - Incoming `__sync` messages that fail validation are dropped and not
 *     rebroadcast (protects against misbehaving peers).
 *
 * @example
 * const brightness = rcState('brightness', 0);
 * brightness.value = 80; // synced to every peer
 */
export function rcState<T>(
	key: string,
	initial: T,
	validate?: (v: unknown) => v is T
): { value: T } {
	ensureKey(key, initial, validate);
	return {
		get value(): T { return (key in _values ? _values[key] : initial) as T; },
		set value(v: T) { setValue(key, v); }
	};
}

/**
 * Remove a synced key locally and broadcast the deletion to all peers.
 * Components using the key fall back to their `initial` value.
 *
 * Deletion is LWW — a concurrent write on another peer may resurrect the key.
 */
export function deleteRcState(key: string): void {
	_validators.delete(key);
	removeValue(key);
	if (connection.status === 'connected') {
		connection.send({ type: '__sync_delete', key });
	}
}

/**
 * The current connection status, read once. Inside a component, use
 * `useConnStatus()`, which re-renders when it changes.
 */
export function connStatus() { return connection.status; }

/**
 * Broadcast a message to all connected peers.
 *
 * The payload is any JSON-serialisable object. A `type` field is conventional
 * for switch-style dispatch in `onMessage`, but not required — the library
 * itself only reserves `type` values starting with `__` (e.g. `__sync`,
 * `__kick`) for internal routing.
 *
 * The sender's identity is available to receivers as the second argument of
 * `onMessage((msg, fromPeerId) => ...)` — authoritative and un-spoofable.
 */
export function send(msg: Record<string, unknown>): void {
	connection.send(msg);
}

/**
 * Call all connected peers with a local media stream (camera/screen).
 * Call this after the connection is established.
 */
export function makeCall(stream: MediaStream): void {
	connection.makeCall(stream);
}

/**
 * Convenience: acquire a local media stream via `getUserMedia` and call all
 * connected peers with it. Supports audio-only, video-only, or both.
 *
 * @example
 *   await startCall({ video: true });
 *   await startCall({ audio: true });
 *   await startCall({ video: { facingMode: 'environment' }, audio: true });
 *
 * @returns the acquired `MediaStream` so the caller can stop its tracks
 * when disconnecting.
 */
export function startCall(constraints: MediaStreamConstraints): Promise<MediaStream> {
	return connection.startCall(constraints);
}

/**
 * Register a handler for an incoming media stream from a peer.
 * Returns an unsubscribe function — callers are responsible for cleanup.
 * Inside a component, use `useOnCall(handler)` instead.
 */
export function onCall(handler: (stream: MediaStream) => void): () => void {
	return connection.onCall(handler);
}

/**
 * Register a handler for incoming messages. Returns an unsubscribe function —
 * callers are responsible for cleanup. Inside a component, use
 * `useOnMessage(handler)` instead.
 */
export function onMessage(
	handler: (msg: Record<string, unknown>, fromPeerId: string) => void
): () => void {
	return connection.onMessage(handler);
}
