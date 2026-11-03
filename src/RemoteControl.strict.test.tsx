import { vi, describe, it, expect, beforeEach } from 'vitest';
import { StrictMode } from 'react';
import { act, render, waitFor } from '@testing-library/react';

// ── PeerJS mock ───────────────────────────────────────────────────────────────
// Peers open and connections succeed at once. The real WebRTCConnection runs
// on top, so these tests cover the component and the core together.
const peers = vi.hoisted(() => ({
	created: [] as { id: string; destroyed: boolean }[],
	dcs: [] as { emit(event: string, ...args: unknown[]): void }[],
}));

vi.mock('peerjs', () => {
	class Emitter {
		#handlers = new Map<string, Set<(...args: unknown[]) => void>>();
		on(event: string, fn: (...args: unknown[]) => void) {
			if (!this.#handlers.has(event)) this.#handlers.set(event, new Set());
			this.#handlers.get(event)!.add(fn);
		}
		once(event: string, fn: (...args: unknown[]) => void) {
			const wrapped = (...args: unknown[]) => { this.off(event, wrapped); fn(...args); };
			(wrapped as { original?: unknown }).original = fn;
			this.on(event, wrapped);
		}
		off(event: string, fn: (...args: unknown[]) => void) {
			const set = this.#handlers.get(event);
			if (!set) return;
			for (const h of set) if (h === fn || (h as { original?: unknown }).original === fn) set.delete(h);
		}
		emit(event: string, ...args: unknown[]) {
			for (const h of [...(this.#handlers.get(event) ?? [])]) h(...args);
		}
	}
	class DataConnection extends Emitter {
		open = true;
		peerConnection = Object.assign(new EventTarget(), {
			connectionState: 'new', iceConnectionState: 'new', remoteDescription: {},
		});
		constructor(public peer: string) {
			super();
			peers.dcs.push(this);
			queueMicrotask(() => this.emit('open'));
		}
		send = vi.fn();
		close = vi.fn();
	}
	let n = 0;
	class Peer extends Emitter {
		id: string;
		options: unknown;
		destroyed = false;
		constructor(...args: unknown[]) {
			super();
			this.id = typeof args[0] === 'string' ? args[0] : `random-${++n}`;
			this.options = typeof args[0] === 'string' ? args[1] : args[0];
			peers.created.push(this);
			queueMicrotask(() => this.emit('open'));
		}
		connect(hostId: string) { return new DataConnection(hostId); }
		destroy() { this.destroyed = true; }
	}
	return { Peer };
});

vi.mock('qrcode', () => ({
	default: { toDataURL: vi.fn(async (url: string) => `data:image/png;qr=${encodeURIComponent(url)}`) },
}));

import RemoteControl from './RemoteControl.js';

function mount() {
	render(<StrictMode><RemoteControl /></StrictMode>);
	return {
		trigger: () => document.querySelector('.rc-trigger')!,
		panel: () => document.querySelector('.rc-popover')!,
	};
}

beforeEach(() => {
	sessionStorage.clear();
	peers.created.length = 0;
	peers.dcs.length = 0;
	history.replaceState(null, '', '/');
});

describe('RemoteControl in StrictMode', () => {
	it('hosts with one Peer, and saves its ID', async () => {
		const { trigger, panel } = mount();
		await waitFor(() => expect(trigger().querySelector('.rc-trigger-dot.rc-awaiting')).not.toBeNull());

		expect(peers.created).toHaveLength(1);
		const id = peers.created[0].id;
		expect(sessionStorage.getItem('rc:hostPeerId')).toBe(id);
		expect(panel().textContent).toContain(`${location.origin}/?id=${id}`);
		await waitFor(() => expect(panel().querySelector('img.rc-qr')).not.toBeNull());
	});

	it('takes the saved host ID again', async () => {
		sessionStorage.setItem('rc:hostPeerId', 'saved-id');
		const { trigger } = mount();
		await waitFor(() => expect(trigger().textContent).toContain('saved-id'.slice(-8)));
		expect(peers.created.map((p) => p.id)).toEqual(['saved-id']);
	});

	it('joins as a client with one Peer, and becomes a host when kicked', async () => {
		history.replaceState(null, '', '/?id=host-peer-id');
		const { trigger, panel } = mount();
		await waitFor(() => expect(trigger().textContent).toContain('CLIENT'));

		expect(peers.created).toHaveLength(1);
		expect(peers.dcs.map((dc) => (dc as unknown as { peer: string }).peer)).toEqual(['host-peer-id']);
		expect(panel().textContent).toContain('host-peer-id');

		act(() => peers.dcs[0].emit('data', { type: '__kick' }));
		await waitFor(() => expect(trigger().querySelector('.rc-trigger-dot.rc-awaiting')).not.toBeNull());
		expect(peers.created).toHaveLength(2);
		expect(peers.created[0].destroyed).toBe(true);
	});

	it('destroys its Peer on unmount', async () => {
		const { unmount } = render(<StrictMode><RemoteControl /></StrictMode>);
		await waitFor(() => expect(document.querySelector('.rc-awaiting')).not.toBeNull());
		unmount();
		expect(peers.created).toHaveLength(1);
		expect(peers.created[0].destroyed).toBe(true);
	});
});
