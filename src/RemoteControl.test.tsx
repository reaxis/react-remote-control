import { vi, describe, it, expect } from 'vitest';
import { act, render } from '@testing-library/react';

// ── WebRTCConnection mock ─────────────────────────────────────────────────────
// Just enough of the connection for the component to mount as an idle host.
const mocks = vi.hoisted(() => {
	const state = {
		status: 'idle',
		role: null,
		localPeerId: '',
		connectedPeers: [] as string[],
		error: null,
		errorType: null,
	};
	return {
		connection: {
			...state,
			getSnapshot: () => state,
			subscribe: () => () => {},
			createOffer: vi.fn(async () => ''),
			acceptOffer: vi.fn(async () => {}),
			destroy: vi.fn(),
			configure: vi.fn(),
			kick: vi.fn(),
			onMessage: vi.fn(() => () => {}),
			onPeerConnect: vi.fn(() => () => {}),
			send: vi.fn(),
			sendTo: vi.fn(),
		},
	};
});

vi.mock('./webrtc.js', () => ({
	WebRTCConnection: vi.fn(function () { return mocks.connection; }),
	DEFAULT_ICE_SERVERS: [],
	INITIAL_STATE: mocks.connection.getSnapshot(),
}));

import RemoteControl from './RemoteControl.js';

// jsdom has no Popover API, like Safari before 17 — the case the fallback is for.
describe('RemoteControl without the Popover API', () => {
	function setup() {
		render(<RemoteControl />);
		return {
			trigger: document.querySelector<HTMLButtonElement>('.rc-trigger')!,
			panel: document.querySelector<HTMLElement>('.rc-popover')!,
		};
	}

	it('mounts even where :popover-open is an invalid selector', () => {
		// What Safari 16's matches() does.
		const matches = vi.spyOn(Element.prototype, 'matches').mockImplementation(function (selector: string) {
			if (selector.includes(':popover-open')) {
				throw new DOMException('The string did not match the expected pattern.', 'SyntaxError');
			}
			return false;
		});
		try {
			expect(setup).not.toThrow();
		} finally {
			matches.mockRestore();
		}
	});

	it('the trigger toggles the panel itself', () => {
		const { trigger, panel } = setup();
		expect(panel.classList.contains('rc-fallback')).toBe(true);
		expect(panel.classList.contains('rc-open')).toBe(false);

		act(() => trigger.click());
		expect(panel.classList.contains('rc-open')).toBe(true);
		expect(trigger.getAttribute('aria-expanded')).toBe('true');

		act(() => trigger.click());
		expect(panel.classList.contains('rc-open')).toBe(false);
	});

	it('Escape and a press outside close it, a press inside does not', () => {
		const { trigger, panel } = setup();
		const press = (target: EventTarget) => act(() => {
			target.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
		});

		act(() => trigger.click());
		press(panel);
		expect(panel.classList.contains('rc-open')).toBe(true);
		press(document.body);
		expect(panel.classList.contains('rc-open')).toBe(false);

		act(() => trigger.click());
		act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
		expect(panel.classList.contains('rc-open')).toBe(false);
	});

	it('puts its styles in the head once, and warns when two share a connection', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		try {
			render(<><RemoteControl /><RemoteControl connection={mocks.connection as never} /></>);
			expect(document.head.querySelectorAll('style[data-href="react-remote-control"]')).toHaveLength(1);
			expect(warn).toHaveBeenCalledWith(expect.stringContaining('multiple components are bound to the same WebRTCConnection'));
		} finally {
			warn.mockRestore();
		}
	});
});
