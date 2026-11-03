import { vi, describe, it, expect, beforeEach } from 'vitest';
import { act, render, renderHook, screen } from '@testing-library/react';

// ── WebRTCConnection mock ─────────────────────────────────────────────────────
// A fake connection with real handler sets and a real snapshot store, so the
// hooks can be driven by "incoming" messages and state changes.
const mocks = vi.hoisted(() => {
	type State = { status: string; connectedPeers: string[] };
	function createConnection() {
		let state: State = { status: 'idle', connectedPeers: [] };
		const listeners = new Set<() => void>();
		const messageHandlers = new Set<(msg: Record<string, unknown>, from: string) => void>();
		const callHandlers = new Set<(stream: MediaStream) => void>();
		return {
			get status() { return state.status; },
			get connectedPeers() { return state.connectedPeers; },
			getSnapshot: () => state,
			subscribe: (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; },
			setState(patch: Partial<State>) {
				state = { ...state, ...patch };
				for (const l of listeners) l();
			},
			messageHandlers,
			onMessage: vi.fn((h: (msg: Record<string, unknown>, from: string) => void) => {
				messageHandlers.add(h);
				return () => { messageHandlers.delete(h); };
			}),
			deliver(msg: Record<string, unknown>, from = 'peer-a') {
				for (const h of messageHandlers) h(msg, from);
			},
			onCall: vi.fn((h: (stream: MediaStream) => void) => {
				callHandlers.add(h);
				return () => { callHandlers.delete(h); };
			}),
			callHandlers,
			onPeerConnect: vi.fn(() => () => {}),
			send: vi.fn(),
			sendTo: vi.fn(),
		};
	}
	return { createConnection, connection: createConnection() };
});

vi.mock('./webrtc.js', () => ({
	WebRTCConnection: vi.fn(function () { return mocks.connection; }),
	DEFAULT_ICE_SERVERS: [],
	INITIAL_STATE: { status: 'idle', connectedPeers: [] },
}));

import { useRcState, useConnection, useConnStatus, useOnMessage, useOnCall } from './hooks.js';
import { deleteRcState } from './rcState.js';
import type { WebRTCConnection } from './webrtc.js';

const conn = mocks.connection;

beforeEach(() => {
	sessionStorage.clear();
	conn.send.mockClear();
	conn.setState({ status: 'idle', connectedPeers: [] });
});

describe('useRcState', () => {
	it('starts at initial, and its setter updates every component using the key', () => {
		function Slider({ label }: { label: string }) {
			const [value, setValue] = useRcState('shared', 1);
			return <button onClick={() => setValue(value + 1)}>{label}:{value}</button>;
		}
		render(<><Slider label="a" /><Slider label="b" /></>);
		expect(screen.getByText('a:1')).toBeTruthy();

		act(() => screen.getByText('a:1').click());
		expect(screen.getByText('a:2')).toBeTruthy();
		expect(screen.getByText('b:2')).toBeTruthy();
		expect(JSON.parse(sessionStorage.getItem('rc:state')!).shared).toBe(2);
	});

	it('accepts an updater function', () => {
		const { result } = renderHook(() => useRcState('updater', 10));
		act(() => result.current[1]((n) => n * 3));
		expect(result.current[0]).toBe(30);
	});

	it('re-renders on an incoming __sync', () => {
		const { result } = renderHook(() => useRcState('incoming', 'a'));
		act(() => conn.deliver({ type: '__sync', key: 'incoming', value: 'b' }));
		expect(result.current[0]).toBe('b');
	});

	it('drops an incoming value that fails the validator', () => {
		const isMode = (v: unknown): v is 'light' | 'dark' => v === 'light' || v === 'dark';
		const { result } = renderHook(() => useRcState('validated', 'light' as 'light' | 'dark', isMode));
		act(() => conn.deliver({ type: '__sync', key: 'validated', value: 42 }));
		expect(result.current[0]).toBe('light');
		act(() => conn.deliver({ type: '__sync', key: 'validated', value: 'dark' }));
		expect(result.current[0]).toBe('dark');
	});

	it('broadcasts writes while connected', () => {
		conn.setState({ status: 'connected', connectedPeers: ['peer-a'] });
		const { result } = renderHook(() => useRcState('broadcast', 0));
		act(() => result.current[1](5));
		expect(conn.send).toHaveBeenCalledWith({ type: '__sync', key: 'broadcast', value: 5 });
	});

	it('falls back to initial after deleteRcState', () => {
		const { result } = renderHook(() => useRcState('deleted', { n: 1 }));
		act(() => result.current[1]({ n: 2 }));
		act(() => deleteRcState('deleted'));
		expect(result.current[0]).toEqual({ n: 1 });
	});
});

describe('useConnection', () => {
	it('re-renders when the connection state changes', () => {
		const other = mocks.createConnection();
		const { result } = renderHook(() => useConnection(other as unknown as WebRTCConnection));
		expect(result.current.status).toBe('idle');
		act(() => other.setState({ status: 'connected', connectedPeers: ['x'] }));
		expect(result.current.status).toBe('connected');
		expect(result.current.connectedPeers).toEqual(['x']);
	});

	it('useConnStatus reads the singleton by default', () => {
		const { result } = renderHook(() => useConnStatus());
		act(() => conn.setState({ status: 'awaiting' }));
		expect(result.current).toBe('awaiting');
	});
});

describe('useOnMessage / useOnCall', () => {
	it('calls the latest handler without resubscribing, and unsubscribes on unmount', () => {
		const other = mocks.createConnection();
		const seen: string[] = [];
		const { rerender, unmount } = renderHook(
			({ tag }) => useOnMessage((msg) => seen.push(`${tag}:${msg.n}`), other as unknown as WebRTCConnection),
			{ initialProps: { tag: 'first' } }
		);
		other.deliver({ n: 1 });
		rerender({ tag: 'second' });
		other.deliver({ n: 2 });
		expect(seen).toEqual(['first:1', 'second:2']);
		expect(other.onMessage).toHaveBeenCalledTimes(1);

		unmount();
		expect(other.messageHandlers.size).toBe(0);
	});

	it('useOnCall passes incoming streams on', () => {
		const other = mocks.createConnection();
		const handler = vi.fn();
		const { unmount } = renderHook(() => useOnCall(handler, other as unknown as WebRTCConnection));
		const stream = {} as MediaStream;
		for (const h of other.callHandlers) h(stream);
		expect(handler).toHaveBeenCalledWith(stream);
		unmount();
		expect(other.callHandlers.size).toBe(0);
	});
});
