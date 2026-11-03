'use client';

/**
 * RemoteControl — UI for the WebRTC primitive (QR code + popover status).
 *
 * Render <RemoteControl /> on any page that needs a connection. Pass
 * `remoteHref="/remote"` to point the QR at a different route; omit for
 * same-route connections. Pass `connection={...}` to bind the UI to a
 * non-singleton `WebRTCConnection` instance.
 */

import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import QRCode from 'qrcode';
import { useConnection, useOnMessage } from './hooks.js';
import { connection as defaultConnection } from './rcState.js';
import { STYLES } from './styles.js';
import type { WebRTCConnection, WebRTCConnectionOptions } from './webrtc.js';

export interface RemoteControlProps {
	/**
	 * Path clients should be sent to (e.g. `"/remote"`). Defaults to the
	 * current page path (same route + `?id=`).
	 */
	remoteHref?: string;
	/** ICE servers, peer server, and other connection options. */
	config?: WebRTCConnectionOptions;
	/**
	 * Optional `WebRTCConnection` instance to bind this UI to. Defaults to the
	 * module-level singleton used by `send`, `useOnMessage`, `useRcState`, etc.
	 * Pass your own when you need multiple independent connections in one app.
	 * Only the instance passed on mount counts.
	 */
	connection?: WebRTCConnection;
}

const PEER_ID_KEY = 'rc:hostPeerId';
const QR_OPTS = { errorCorrectionLevel: 'M' as const, width: 240, margin: 3 };

// Tracks which `WebRTCConnection` instances are currently bound to a mounted
// `<RemoteControl />`. Used to warn when two components share one connection.
const mountedConnections = new WeakSet<object>();

const noSubscribe = () => () => {};

/**
 * The Popover API needs Safari 17+ (so iPadOS/iOS 17+ for every browser
 * there). Without it, `:popover-open` is an invalid selector — `matches()`
 * throws a SyntaxError — and `popover` / `popoverTarget` do nothing, so the
 * panel is shown and hidden by the component itself instead. `false` while
 * server rendering and hydrating, so both render the same markup.
 */
function usePopoverSupported(): boolean {
	return useSyncExternalStore(
		noSubscribe,
		() => Object.prototype.hasOwnProperty.call(HTMLElement.prototype, 'popover'),
		() => false
	);
}

/** A QR code (data URL) for `url`, or `''`. Regenerated only when the string changes. */
function useQrCode(url: string): string {
	const [qr, setQr] = useState('');
	useEffect(() => {
		if (!url) { setQr(''); return; }
		let cancelled = false;
		QRCode.toDataURL(url, QR_OPTS).then((data) => { if (!cancelled) setQr(data); });
		return () => { cancelled = true; };
	}, [url]);
	return qr;
}

function isSuperseded(err: unknown): boolean {
	return (err as { type?: unknown } | null)?.type === 'superseded';
}

function sessionGet(key: string): string | undefined {
	try { return sessionStorage.getItem(key) ?? undefined; } catch { return undefined; }
}

function sessionSet(key: string, value: string): void {
	try { sessionStorage.setItem(key, value); } catch { /* ignore */ }
}

function shortId(id: string | undefined): string {
	return id ? id.slice(-8) : '';
}

function cx(...classes: (string | false | null | undefined)[]): string {
	return classes.filter(Boolean).join(' ');
}

function CopyButton({ text, title }: { text: string; title: string }) {
	const [copied, setCopied] = useState(false);
	async function copy() {
		if (!text) return;
		await navigator.clipboard.writeText(text);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	}
	return <button className={cx('rc-copy', copied && 'rc-copied')} onClick={copy} title={title} aria-label={title}></button>;
}

function Field({ label, text, copyTitle }: { label: string; text: string; copyTitle: string }) {
	return (
		<div className="rc-field-row">
			<span className="rc-field-label">{label}</span>
			<div className="rc-peer-id">
				<span className="rc-peer-id-text">{text}</span>
				<CopyButton text={text} title={copyTitle} />
			</div>
		</div>
	);
}

function NoRouteHint() {
	return <p className="rc-hint">The network seems to block a direct connection between the devices. This often happens when both are on the same Wi-Fi; switching one to mobile data usually helps.</p>;
}

export function RemoteControl({ remoteHref, config, connection: injectedConnection }: RemoteControlProps) {
	// Swapping the `connection` prop mid-life is not supported: the lifecycle
	// effects below bind to the instance passed on mount.
	const [conn] = useState(() => injectedConnection ?? defaultConnection);
	const { status, error, errorType, connectedPeers, role, localPeerId } = useConnection(conn);
	const popoverSupported = usePopoverSupported();
	const popoverId = useId();

	// Read once on mount: client-side URL rewrites (e.g. history.pushState to
	// strip `?id=…` after connecting) must not tear down the live connection.
	// Set from the mount effect rather than during render, so the server and
	// the hydrating client render the same.
	const [clientId, setClientId] = useState<string | null>(null);
	const isClient = clientId !== null ? role !== 'host' : role === 'client';

	// ── Client state ────────────────────────────────────────────────────────
	const [peerIdInput, setPeerIdInput] = useState('');
	const anchorRef = useRef<HTMLDivElement>(null);
	const popoverRef = useRef<HTMLDivElement>(null);
	const [popoverOpen, setPopoverOpen] = useState(false);
	const [retryPeerId, setRetryPeerId] = useState<string | null>(null);
	const [retryAttempt, setRetryAttempt] = useState(0);
	const [retryCountdown, setRetryCountdown] = useState(0);
	// Kept across retries: each attempt clears `errorType` while it runs, but
	// the reason the previous one failed is still worth showing.
	const [lastErrorType, setLastErrorType] = useState<string | null>(null);

	// ── Derived URLs ─────────────────────────────────────────────────────────
	// Plain strings, so the QR effects only re-run when one actually changes.

	const isBrowser = typeof window !== 'undefined';
	const basePath = isBrowser ? (remoteHref ?? window.location.pathname).replace(/\/?$/, '/') : '/';

	const remoteUrl = !isClient && localPeerId && isBrowser
		? `${window.location.origin}${basePath}?id=${localPeerId}`
		: '';

	// First connected peer (the host, for clients). Empty string when no peers
	// are connected.
	const connectedPeer = connectedPeers[0] ?? '';

	const hostUrl = isClient && status === 'connected' && connectedPeer && isBrowser
		? `${window.location.origin}${basePath}?id=${connectedPeer}`
		: '';

	const peerQr = useQrCode(remoteUrl);
	const hostQr = useQrCode(hostUrl);

	// ── Actions ──────────────────────────────────────────────────────────────
	// Only `conn` and state setters inside, all stable, so the mount-time
	// copies the effects below hold stay correct.

	async function startOffer() {
		conn.destroy();
		try {
			await conn.createOffer(sessionGet(PEER_ID_KEY));
		} catch {
			return; // shown through `status` / `error`
		}
		sessionSet(PEER_ID_KEY, conn.localPeerId);
	}

	async function connect(id: string) {
		setRetryPeerId(id);
		await conn.acceptOffer(id);
	}

	function disconnect() {
		// `startOffer()` already calls `conn.destroy()`; calling `stopRetry()`
		// here would destroy twice and churn the status.
		setRetryPeerId(null);
		setRetryAttempt(0);
		startOffer();
	}

	function stopRetry() {
		setRetryPeerId(null);
		setRetryAttempt(0);
		conn.destroy();
	}

	// ── Lifecycle ────────────────────────────────────────────────────────────
	// Dev guard: warn if two `<RemoteControl />` instances bind to the same
	// `WebRTCConnection`. Each instance owns the lifecycle of its connection
	// (createOffer / destroy on mount/unmount), so sharing one leads to
	// connection thrash. Pass distinct `connection={...}` props instead.
	useEffect(() => {
		if (mountedConnections.has(conn)) {
			console.warn(
				'RemoteControl: multiple components are bound to the same WebRTCConnection. ' +
				'Pass a distinct `connection={...}` prop per instance.'
			);
		}
		mountedConnections.add(conn);
		return () => { mountedConnections.delete(conn); };
	}, [conn]);

	// Before the mount effect below (effects run in order), so the first
	// attempt already uses `config`.
	useEffect(() => { if (config) conn.configure(config); }, [conn, config]);

	useEffect(() => {
		const id = new URLSearchParams(window.location.search).get('id');
		setClientId(id);
		// A failed connect shows through `status` / `errorType` and the retry
		// effect; the rejection itself needs no handler. In StrictMode this runs
		// twice; the core drops the first attempt (`'superseded'`).
		if (id) connect(id).catch(() => {});
		else startOffer();
		return () => conn.destroy();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [conn]);

	useOnMessage((msg) => {
		if (msg.type === '__kick') disconnect();
	}, conn);

	// Popover open/close as a single source of truth. The effect syncs state
	// → DOM (idempotent — checks current popover state first), and `onToggle`
	// on the popover element syncs DOM → state (captures manual user dismiss
	// via Escape / outside click / trigger button).
	useEffect(() => {
		const el = popoverRef.current;
		if (!el || !popoverSupported) return;
		const isOpen = el.matches(':popover-open');
		if (popoverOpen && !isOpen) el.showPopover();
		else if (!popoverOpen && isOpen) el.hidePopover();
	}, [popoverOpen, popoverSupported]);

	// Fallback light dismiss, as `popover="auto"` gives natively: Escape or a
	// press outside the trigger and panel closes it.
	useEffect(() => {
		if (popoverSupported || !popoverOpen) return;
		const onPointerDown = (e: PointerEvent) => {
			if (anchorRef.current && !anchorRef.current.contains(e.target as Node)) setPopoverOpen(false);
		};
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Escape') setPopoverOpen(false);
		};
		document.addEventListener('pointerdown', onPointerDown);
		document.addEventListener('keydown', onKeyDown);
		return () => {
			document.removeEventListener('pointerdown', onPointerDown);
			document.removeEventListener('keydown', onKeyDown);
		};
	}, [popoverSupported, popoverOpen]);

	// Client flow: auto-open while connecting, auto-close once connected.
	// The user can still manually reopen via the trigger button at any time.
	useEffect(() => {
		if (!isClient) return;
		if (status === 'gathering') setPopoverOpen(true);
		else if (status === 'connected') setPopoverOpen(false);
	}, [isClient, status]);

	useEffect(() => {
		if (status === 'error') setLastErrorType(errorType);
		else if (status === 'connected' || !retryPeerId) setLastErrorType(null);
	}, [status, errorType, retryPeerId]);

	useEffect(() => {
		if (!retryPeerId || (status !== 'disconnected' && status !== 'error')) return;

		// `retryAttempt` is a dependency: each bump re-runs this effect and
		// schedules the next retry, whether or not `status` also changed.
		const delay = Math.min(1000 * 2 ** retryAttempt, 30_000);
		setRetryCountdown(Math.ceil(delay / 1000));

		const tick = setInterval(() => setRetryCountdown((n) => n - 1), 1000);
		const timer = setTimeout(async () => {
			clearInterval(tick);
			try {
				await connect(retryPeerId);
				setRetryAttempt(0);
			} catch (err) {
				// A superseded attempt was stopped on purpose (Stop, Disconnect).
				if (!isSuperseded(err)) setRetryAttempt((n) => n + 1);
			}
		}, delay);

		return () => { clearInterval(tick); clearTimeout(timer); };
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [retryPeerId, status, retryAttempt]);

	// ── Render ───────────────────────────────────────────────────────────────

	const peerLabel = localPeerId && <span className="rc-trigger-label">…{shortId(localPeerId)}</span>;

	function trigger() {
		switch (status) {
			case 'idle':
			case 'gathering':
				return <span className="rc-trigger-spinner"></span>;
			case 'connected':
				return <>
					<span className="rc-trigger-dot rc-connected"></span>
					<span className="rc-trigger-role">{isClient ? 'CLIENT' : 'HOST'}</span>
					<span className="rc-trigger-label">…{shortId(localPeerId)}</span>
					{!isClient && <span className="rc-trigger-count">{connectedPeers.length}</span>}
				</>;
			case 'awaiting':
				return <>
					<span className="rc-trigger-dot rc-awaiting"></span>
					<span className="rc-trigger-label">…{shortId(localPeerId)}</span>
				</>;
			case 'disconnected':
				return <><span className="rc-trigger-dot rc-disconnected"></span>{peerLabel}</>;
			case 'error':
				return <><span className={cx('rc-trigger-dot', retryPeerId ? 'rc-disconnected' : 'rc-error')}></span>{peerLabel}</>;
		}
	}

	function retrying() {
		return <>
			<p className="rc-hint">Retrying in {retryCountdown}s…</p>
			<button className="rc-btn" onClick={stopRetry}>Stop</button>
		</>;
	}

	function clientPanel() {
		switch (status) {
			case 'gathering':
				return <>
					<p className="rc-hint">Connecting…</p>
					<div className="rc-spinner"></div>
					{retryPeerId && lastErrorType === 'no-route' && <NoRouteHint />}
				</>;
			case 'idle':
				return retryPeerId && <>
					<p className="rc-badge rc-disconnected">Disconnected</p>
					<button className="rc-btn" onClick={() => connect(retryPeerId).catch(() => {})}>Reconnect</button>
				</>;
			case 'connected':
				return <>
					{hostQr && <img src={hostQr} alt="Host QR code" className="rc-qr" />}
					<Field label="URL" text={hostUrl} copyTitle="Copy URL" />
					<Field label="ID" text={connectedPeer} copyTitle="Copy host ID" />
				</>;
			case 'disconnected':
				return <>
					<p className="rc-badge rc-disconnected">Disconnected</p>
					{retryPeerId ? retrying() : <button className="rc-btn" onClick={() => conn.destroy()}>Reset</button>}
				</>;
			case 'error':
				if (!retryPeerId) {
					return <>
						<p className="rc-badge rc-error">Error: {error}</p>
						<button className="rc-btn" onClick={() => conn.destroy()}>Reset</button>
					</>;
				}
				return <>
					{errorType === 'no-route' ? <>
						<p className="rc-badge rc-error">Can't reach the host</p>
						<NoRouteHint />
					</> : errorType === 'peer-unavailable' ? <>
						<p className="rc-badge rc-disconnected">Host not found</p>
						<p className="rc-hint">Is the host still open?</p>
					</> : <p className="rc-badge rc-disconnected">Disconnected</p>}
					{retrying()}
				</>;
			default:
				return null;
		}
	}

	function hostPanel() {
		switch (status) {
			case 'idle':
			case 'gathering':
				return <div className="rc-spinner"></div>;
			case 'awaiting':
			case 'connected':
				return <>
					{peerQr && <img src={peerQr} alt="Peer ID QR code" className="rc-qr" />}
					<Field label="URL" text={remoteUrl} copyTitle="Copy URL" />
					<Field label="ID" text={localPeerId} copyTitle="Copy ID" />
					{status === 'awaiting' ? <>
						<p className="rc-hint">Waiting for a client to connect…</p>
						<hr className="rc-divider" />
						<p className="rc-hint">… or connect to a host by ID:</p>
						<div className="rc-connect-row">
							<input className="rc-input" type="text" placeholder="Paste ID…" value={peerIdInput} onChange={(e) => setPeerIdInput(e.target.value)} />
							<button className="rc-btn rc-btn-sm" onClick={() => connect(peerIdInput.trim()).catch(() => {})} disabled={!peerIdInput.trim()}>Connect</button>
						</div>
					</> : <>
						<hr className="rc-divider" />
						<div className="rc-remotes">
							<span className="rc-remotes-label">Connected clients</span>
							<ul className="rc-remotes-list">
								{connectedPeers.map((id) => (
									<li key={id} title={id}>
										<span>…{shortId(id)}</span>
										<button className="rc-kick" onClick={() => conn.kick(id)} aria-label={`Disconnect ${id}`}>✕</button>
									</li>
								))}
							</ul>
						</div>
					</>}
				</>;
			case 'disconnected':
				return <>
					<p className="rc-badge rc-disconnected">Disconnected</p>
					<button className="rc-btn" onClick={startOffer}>Reconnect</button>
				</>;
			case 'error':
				return <>
					<p className="rc-badge rc-error">Error: {error}</p>
					<button className="rc-btn" onClick={startOffer}>Retry</button>
				</>;
		}
	}

	return (
		<div className="rc-anchor" ref={anchorRef}>
			<style href="react-remote-control" precedence="default">{STYLES}</style>
			<button
				className="rc-trigger"
				popoverTarget={popoverId}
				aria-label="Connection status"
				aria-expanded={popoverSupported ? undefined : popoverOpen}
				onClick={() => { if (!popoverSupported) setPopoverOpen((open) => !open); }}
			>
				{trigger()}
			</button>

			<div
				id={popoverId}
				popover="auto"
				className={cx('rc-popover', !popoverSupported && 'rc-fallback', popoverOpen && 'rc-open')}
				ref={popoverRef}
				onToggle={(e) => setPopoverOpen(e.newState === 'open')}
			>
				<div className="rc-header">
					<h2 className="rc-title">Remote Control</h2>
					{isClient && status === 'connected' && (
						<button className="rc-btn rc-btn-sm" onClick={disconnect}>Disconnect</button>
					)}
				</div>

				{isClient ? clientPanel() : hostPanel()}
			</div>
		</div>
	);
}

export default RemoteControl;
