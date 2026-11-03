# react-remote-control

[![npm version](https://img.shields.io/npm/v/react-remote-control.svg)](https://www.npmjs.com/package/react-remote-control)
[![CI](https://github.com/reaxis/react-remote-control/actions/workflows/ci.yml/badge.svg)](https://github.com/reaxis/react-remote-control/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/react-remote-control.svg)](./LICENSE)

Peer-to-peer connection primitive for React 19 apps. Connect a host (e.g. a laptop) to one or more clients (e.g. phones) over WebRTC with a single `<RemoteControl />` component: no signalling server to run yourself, a QR code UI out of the box, and state hooks that sync across peers.

Built on [PeerJS](https://peerjs.com) for WebRTC transport. The React port of [svelte-remote-control](https://github.com/reaxis/svelte-remote-control), and wire-compatible with it: a React app and a Svelte app can connect to each other and share synced state.

## Features

- **Drop-in UI**: `<RemoteControl />` renders a floating status indicator with QR code, copyable peer ID, and connection management.
- **Synced state**: `useRcState()` works like `useState`, but the value syncs across all connected peers (last-write-wins).
- **Data channel**: broadcast JSON messages between peers with `send()` / `useOnMessage()`.
- **Media calls**: stream camera or microphone between peers with `startCall()` / `useOnCall()`.
- **Auto-reconnect**: exponential backoff on connection loss, keeping the host's peer ID across reloads.
- **StrictMode- and SSR-safe**: one connection, however often effects re-run; `'use client'` and no browser API use during render, so it works in Next.js.
- **No signalling server required**: uses the free public PeerJS broker by default; bring your own with `config`.

## Installation

```bash
npm install react-remote-control peerjs qrcode
```

Peer dependencies: `react >= 19`, `peerjs`, `qrcode`.

## Quick start

Render `<RemoteControl />` on a page and share one value between the host (laptop) and any client (phone) that connects to it:

```tsx
import RemoteControl, { useRcState } from 'react-remote-control';

export default function App() {
    const [brightness, setBrightness] = useRcState('brightness', 50);

    return (
        <>
            <RemoteControl />
            <input type="range" min="0" max="100" value={brightness}
                onChange={(e) => setBrightness(e.target.valueAsNumber)} />
            <p>Brightness: {brightness}</p>
        </>
    );
}
```

Open the page on your laptop, scan the QR code with your phone or open the link in another tab, and dragging the slider on either device/tab updates the other instantly.

## Component

### `<RemoteControl />`

Renders a small floating status trigger (top-right) with a popover containing:
- A QR code and copyable URL for clients to scan.
- Connection status (idle / gathering / awaiting / connected / disconnected / error).
- The list of connected peer IDs on the host side, each with a button to disconnect it.
- A manual-entry field for pasting a peer ID.
- Retry state (countdown and stop button) on the client side, with the reason when it can't connect: "Host not found", or "Can't reach the host" (see [TURN servers](#turn-servers)).

Its styles come with it (a React 19 `<style>` that React puts in `<head>` once); every class starts with `rc-`, so you can override them.

#### Props

| Prop | Type | Default | Description |
|---|---|---|---|
| `remoteHref` | `string` | current page path | Path clients should be sent to (e.g. `"/remote"`). Omit for same-route connections (useful for peer-to-peer symmetric apps); set when host and client interfaces are on different routes. |
| `config` | `WebRTCConnectionOptions` | — | ICE servers and/or PeerJS broker for this instance. Merged into the bound `WebRTCConnection` via `configure()`; fields take effect on the next `createOffer()` / `acceptOffer()`. |
| `connection` | `WebRTCConnection` | module singleton | Bind this UI to a caller-supplied `WebRTCConnection`. Use when you need multiple independent connections in one app. Only the instance passed on mount counts. Rendering two `<RemoteControl />` components against the same connection logs a warning (each owns the connection's lifecycle). |

The component detects its role from the URL: if `?id=…` is present, it acts as a client and joins that peer ID; otherwise, it acts as a host and advertises its own ID. Render one per page, and keep it mounted for as long as the connection should live: unmounting it closes the connection.

## Synced state

### `useRcState<T>(key, initial, validate?)`

A value that syncs to all connected peers, used like `useState`:

```tsx
import { useRcState } from 'react-remote-control';

const [brightness, setBrightness] = useRcState('brightness', 50);
setBrightness(80);
setBrightness((b) => b + 1);
```

Every component that uses the same `key`, on this device or a connected one, sees the same value. Writes broadcast a `__sync` message to all peers; receivers update their local copy and rebroadcast to their remaining peers (with the sender excluded to prevent echo).

Values are persisted to `sessionStorage` (`rc:state`) so they survive page reloads within the tab. Values must be JSON-serialisable. As with `useState`, only the first `initial` counts. During server rendering and hydration the hook returns `initial`.

#### Validation

Pass an optional type-guard to protect against malformed peers and schema changes across sessions:

```ts
const [mode, setMode] = useRcState<'light' | 'dark'>('mode', 'light',
    (v): v is 'light' | 'dark' => v === 'light' || v === 'dark');
```

- Persisted values that fail validation are replaced with `initial`.
- Incoming `__sync` messages that fail validation are dropped and **not** rebroadcast.

#### Sync semantics

Synced state is **last-write-wins (LWW)** without causal ordering. Concurrent writes from different peers silently overwrite each other; the order of arrival on each peer determines the final value, so peers may temporarily disagree until the network settles. Suitable for UI state (slider positions, toggles, form inputs) where occasional lost updates are tolerable. **Not** suitable for counters, carts, or anything requiring convergence under concurrent edits.

### `rcState<T>(key, initial, validate?)`

The same value outside components (plain modules, timers, tests): returns an object whose `value` you read and write. It doesn't re-render anything by itself, but components using `useRcState(key, …)` do.

```ts
import { rcState } from 'react-remote-control';

const brightness = rcState('brightness', 50);
brightness.value = 80; // synced, and every useRcState('brightness', …) re-renders
```

### `deleteRcState(key)`

Remove a synced key locally and broadcast the deletion. Components using it fall back to their `initial`. Deletion is also LWW: a concurrent write on another peer may resurrect the key.

## Connection state

### `useConnStatus()` / `useConnection()`

```tsx
import { useConnStatus, useConnection } from 'react-remote-control';

const connected = useConnStatus() === 'connected';
const { status, connectedPeers, role, localPeerId, error, errorType } = useConnection();
```

Both re-render when the state changes. Status values: `'idle' | 'gathering' | 'awaiting' | 'connected' | 'disconnected' | 'error'`. Both take an optional `WebRTCConnection` (default: the singleton). Outside components, `connStatus()` reads the status once.

## Messaging

### `send(message)`

Broadcast a JSON-serialisable message to all connected peers.

```ts
import { send } from 'react-remote-control';

send({ type: 'notification', title: 'Hi!', urgency: 2 });
```

The payload is any plain object. A `type` field is conventional for switch-style dispatch, but not required. The only constraint: `type` values starting with `__` are reserved for library-internal messages (`__sync`, `__sync_delete`, `__kick`).

### `useOnMessage(handler, connection?)`

Call `handler` for every incoming message while the component is mounted. The latest `handler` is used, so it can read current props and state without resubscribing:

```tsx
import { useOnMessage } from 'react-remote-control';

useOnMessage((msg, fromPeerId) => {
    if (msg.type === 'notification') console.log(`From ${fromPeerId}: ${msg.title}`);
});
```

`fromPeerId` is the authoritative peer ID from the underlying DataConnection; the sender can't spoof it. Outside components, `onMessage(handler)` returns an unsubscribe function.

## Media calls

### `startCall(constraints): Promise<MediaStream>`

Acquire a local media stream via `getUserMedia` and call all connected peers with it:

```ts
import { startCall } from 'react-remote-control';

await startCall({ video: true });                              // video only
await startCall({ audio: true });                              // audio only
await startCall({ video: { facingMode: 'environment' } });     // constraints
```

Returns the acquired `MediaStream` so you can stop its tracks when disconnecting.

### `makeCall(stream)`

Lower-level: call all connected peers with a stream you acquired yourself, e.g. acquired before connecting and called after.

### `useOnCall(handler, connection?)`

Call `handler` for every incoming stream while the component is mounted:

```tsx
import { useRef } from 'react';
import { useOnCall } from 'react-remote-control';

const videoRef = useRef<HTMLVideoElement>(null);
useOnCall((stream) => {
    videoRef.current!.srcObject = stream;
    videoRef.current!.play();
});
```

Outside components, `onCall(handler)` returns an unsubscribe function.

## Advanced: multi-instance connections

The singleton covers most cases, but if you need multiple independent connections in one app, create your own and pass it to the component and hooks:

```tsx
import { RemoteControl, WebRTCConnection, useConnection, useOnMessage } from 'react-remote-control';

const second = new WebRTCConnection(); // module level: one per app

function SecondPanel() {
    const { status } = useConnection(second);
    useOnMessage((msg) => console.log(msg), second);
    return <RemoteControl connection={second} />;
}
```

`useRcState` and `send` always use the singleton; on another connection, use `conn.send()` / `conn.sendTo()`.

The class works without React too:

```ts
const conn = new WebRTCConnection();

await conn.createOffer();       // host
await conn.acceptOffer(hostId); // client

conn.send({ type: 'ping' });
conn.onMessage((msg, from) => console.log(from, msg));

conn.status;           // ConnectionStatus
conn.connectedPeers;   // string[]
conn.localPeerId;      // string
conn.role;             // 'host' | 'client' | null
conn.error;            // string | null
conn.errorType;        // string | null: 'no-route', 'peer-unavailable', or another PeerJS error type
conn.subscribe(() => console.log(conn.getSnapshot())); // every state change
```

When a newer `createOffer()` / `acceptOffer()` or a `destroy()` replaces an attempt that is still running, the old one rejects with an error whose `type` is `'superseded'` and leaves the state alone.

Pass custom ICE servers (see [TURN servers](#turn-servers)) and/or a custom PeerJS broker (e.g. a self-hosted [peerjs-server](https://github.com/peers/peerjs-server)):

```ts
const conn = new WebRTCConnection({
    iceServers: [...DEFAULT_ICE_SERVERS, { urls: 'turn:my-turn.example.com', username: 'u', credential: 'c' }],
    peerServer: { host: 'my-peer.example.com', port: 9000, path: '/myapp', secure: true },
});
```

The same options go into `<RemoteControl config={…} />` for the singleton.

## TURN servers

Out of the box the library only uses STUN servers (`DEFAULT_ICE_SERVERS`), so the two devices must reach each other directly. That works on most networks, but not all. Typical failures:

- **Both devices on the same Wi-Fi.** Many routers block traffic between their own devices (guest networks usually do), or don't route a device's traffic to the network's own public address ("NAT hairpinning"). The give-away: it works as soon as you switch the phone to mobile data.
- **Guest, public or corporate networks** that only allow web traffic.
- **Strict NATs**, on some mobile networks.

A TURN server fixes all of these: when no direct path works, it relays the traffic. WebRTC tries direct paths first and only falls back to the relay, so you only pay for traffic that couldn't go direct.

### Symptom

After about 15 seconds of trying, the client shows "Can't reach the host" (and keeps retrying), and both devices log a `WebRTCConnection: could not connect to peer …` warning in the console. It says whether a TURN server was configured and, if it was, what went wrong with it. `chrome://webrtc-internals` shows the details for each attempt.

### Setup

**1. Get a TURN service.** For example:

- [Cloudflare Realtime TURN](https://developers.cloudflare.com/realtime/turn/): 1,000 GB free, then $0.05/GB. Includes `turns:` on port 443, which gets through most firewalls. Credentials are short-lived and generated by an API call.
- [Metered](https://www.metered.ca/stun-turn): a small free tier, with an API for credentials.
- Your own [coturn](https://github.com/coturn/coturn) server. Needs open UDP/TCP ports on the server.

**2. Keep the API secret on a server, and give the browser short-lived credentials.** TURN credentials in client code can be copied and used by anyone, so get them from an endpoint of your own. With Cloudflare and a Next.js route handler:

```ts
// app/api/turn/route.ts
export async function GET() {
    const res = await fetch(
        `https://rtc.live.cloudflare.com/v1/turn/keys/${process.env.TURN_KEY_ID}/credentials/generate-ice-servers`,
        {
            method: 'POST',
            headers: { Authorization: `Bearer ${process.env.TURN_KEY_API_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ ttl: 86400 }), // seconds the credentials stay valid
        },
    );
    if (!res.ok) return Response.json({ error: 'No TURN credentials' }, { status: 502 });
    const { iceServers } = await res.json(); // STUN and TURN entries, ready for RTCPeerConnection
    return Response.json({ iceServers });
}
```

A static site can't have a server route; put the endpoint anywhere else (a Cloudflare Worker, a small Node server) and allow your site's origin with CORS.

**3. Pass a function as `iceServers`.** It's called for every new connection (including each automatic retry) and once an hour while a connection lives, so the credentials are always fresh. If it throws, that connection uses `DEFAULT_ICE_SERVERS` (with a console warning), so the app keeps working on networks that don't need a relay:

```tsx
import RemoteControl from 'react-remote-control';

async function iceServers(): Promise<RTCIceServer[]> {
    const res = await fetch('/api/turn', { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`TURN credentials: HTTP ${res.status}`);
    return (await res.json()).iceServers;
}

const config = { iceServers }; // module level, so it's the same object every render

export function Page() {
    return <RemoteControl config={config} />;
}
```

Do this on every page that renders `<RemoteControl />`, host and client alike. The list replaces the defaults rather than adding to them, so include STUN servers too (Cloudflare's response already does; otherwise spread `...DEFAULT_ICE_SERVERS` in). Give the credentials a `ttl` of a few hours or more: the hourly refresh only reaches new connections, so a relayed connection that outlives its credentials drops, and then reconnects with fresh ones.

A fixed list (`iceServers: [...]`) works as well, e.g. with static credentials, but isn't refreshed.

## How it works

- **Signalling** uses the free public [PeerJS broker](https://peerjs.com/peerserver). No server setup required. The host publishes a random peer ID, the client scans/enters it to establish a WebRTC connection. After that, all traffic is peer-to-peer.
- **Topology** is a star: clients connect to the host; the host relays `__sync` messages between clients so they stay in sync with each other.
- **Storage** uses `sessionStorage` with the `rc:` prefix (`rc:state`, `rc:hostPeerId`) so the library is self-contained and won't collide with host-app keys.
- **Transport** is PeerJS DataConnections (reliable, JSON-serialised) for messages, and MediaConnections for streams.
- **React** reads the connection and the synced values through `useSyncExternalStore`, so components re-render exactly when what they read changes.

## Requirements

- React 19 or newer. Works with Vite, Next.js (App Router: the component and hooks are client components) or any other setup.
- A browser with WebRTC support (all modern evergreen browsers). The status panel uses the Popover API where available and falls back to its own show/hide elsewhere (e.g. Safari before 17).
- HTTPS or `localhost` for `getUserMedia` in media calls.

## Security considerations

- Messages are **not authenticated**. Any peer that knows the ID can connect and send arbitrary payloads. The peer ID serves as a capability token: treat it like a share-link.
- For privileged operations, implement an application-level handshake with a custom message type and a shared secret exchanged out-of-band (e.g. via the QR code).
- WebRTC itself encrypts all traffic (DTLS for data, SRTP for media), so payloads are private in transit.

## Troubleshooting

- **"Connected" status but video never appears**: check that the host's `useOnCall()` is mounted before the client calls `startCall()`. A stream that arrives before the handler is registered is missed.
- **Peers connect on desktop but not on phone**: WebRTC requires HTTPS on non-localhost origins. Serve your app over HTTPS (e.g. `ngrok`, Cloudflare Tunnel, or a TLS cert).
- **Client says "Can't reach the host", e.g. with both devices on the same Wi-Fi, or behind a corporate firewall**: no direct path between the devices works, and there is no relay to fall back on. The console explains more. Configure a TURN server: see [TURN servers](#turn-servers).
- **Client says "Host not found"**: the host didn't answer within 10 seconds: its page is closed, or it has a new ID (scan its QR code again).
- **QR code scans, app opens, but never connects**: the phone's PeerJS client can't reach the signalling broker. Usually a corporate captive portal. Switch networks or host your own PeerJS server.
- **iOS Safari: audio doesn't play**: autoplay is blocked without a user gesture. Require a "Start" button tap before calling `startCall()`.

## Development playground

`npm run dev` starts the playground (`playground/`, a Vite app rendered in StrictMode). Open it, then scan the QR code with a phone or open the link in a second tab to connect as a client. It uses the same keys as svelte-remote-control's playground (`brightness`, `hue`), so the two can be connected to each other. To try it with TURN, set `VITE_TURN_CREDENTIALS_URL` to an endpoint like the one in [TURN servers](#turn-servers) when running or building it. To try it with your own PeerJS broker, set `VITE_PEER_SERVER_URL` to its address (absolute, or a path on the same site). `BASE_PATH` sets the folder a build is served from (default `/`).

`npm test` runs the tests, `npm run check` type-checks, and `npm run prepack` builds `dist/`.

## License

MIT
