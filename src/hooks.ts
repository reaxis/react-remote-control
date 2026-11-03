'use client';

/**
 * React bindings for the connection and the synced value store. Each hook
 * reads through `useSyncExternalStore`, so it re-renders exactly when its
 * value changes, and server rendering / hydration see the initial state.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { connection, ensureKey, readValue, setValue, subscribeValues } from './rcState.js';
import { INITIAL_STATE, type ConnectionState, type ConnectionStatus, type WebRTCConnection } from './webrtc.js';

/**
 * A value that syncs to all connected peers, used like `useState`.
 *
 * Every component that uses the same `key`, on this device or any connected
 * one, sees the same value. Values persist in `sessionStorage` (`rc:state`),
 * so they survive a reload of the tab. Sync is last-write-wins: fine for UI
 * state (sliders, toggles), not for counters or carts.
 *
 * @param key      Unique key across all peers.
 * @param initial  Value until one is stored or synced. Only its first value
 *                 counts, as with `useState`.
 * @param validate Optional type guard. A stored value that fails it is
 *                 replaced with `initial`; an incoming one is dropped.
 *
 * @example
 * const [brightness, setBrightness] = useRcState('brightness', 50);
 */
export function useRcState<T>(
	key: string,
	initial: T,
	validate?: (v: unknown) => v is T
): [T, (next: T | ((prev: T) => T)) => void] {
	const [initialValue] = useState(initial);
	ensureKey(key, initialValue, validate);

	const read = () => {
		const value = readValue(key);
		return (value === undefined ? initialValue : value) as T;
	};
	const value = useSyncExternalStore(subscribeValues, read, () => initialValue);

	const set = useCallback((next: T | ((prev: T) => T)) => {
		const prev = readValue(key);
		setValue(key, typeof next === 'function'
			? (next as (prev: T) => T)((prev === undefined ? initialValue : prev) as T)
			: next);
	}, [key, initialValue]);

	return [value, set];
}

/**
 * The connection's state (status, peers, role, peer ID, error), re-rendering
 * on every change. Defaults to the module-level singleton.
 */
export function useConnection(conn: WebRTCConnection = connection): ConnectionState {
	return useSyncExternalStore(conn.subscribe, conn.getSnapshot, () => INITIAL_STATE);
}

/**
 * The connection status, re-rendering when it changes.
 * e.g. `const connected = useConnStatus() === 'connected'`
 */
export function useConnStatus(conn: WebRTCConnection = connection): ConnectionStatus {
	return useConnection(conn).status;
}

/** Keeps a ref to the latest `value`, so subscriptions needn't resubscribe on every render. */
function useLatest<T>(value: T) {
	const ref = useRef(value);
	useLayoutEffect(() => { ref.current = value; });
	return ref;
}

/**
 * Call `handler` for every incoming message while the component is mounted.
 * The latest `handler` is used, so it can read current props and state.
 *
 * @example
 * useOnMessage((msg, fromPeerId) => {
 *     if (msg.type === 'notification') console.log(fromPeerId, msg.title);
 * });
 */
export function useOnMessage(
	handler: (msg: Record<string, unknown>, fromPeerId: string) => void,
	conn: WebRTCConnection = connection
): void {
	const latest = useLatest(handler);
	useEffect(() => conn.onMessage((msg, from) => latest.current(msg, from)), [conn, latest]);
}

/**
 * Call `handler` for every incoming media stream while the component is
 * mounted. The latest `handler` is used.
 *
 * @example
 * useOnCall((stream) => { videoRef.current!.srcObject = stream; });
 */
export function useOnCall(
	handler: (stream: MediaStream) => void,
	conn: WebRTCConnection = connection
): void {
	const latest = useLatest(handler);
	useEffect(() => conn.onCall((stream) => latest.current(stream)), [conn, latest]);
}
