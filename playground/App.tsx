import RemoteControl, { useRcState, type PeerServerOptions, type WebRTCConnectionOptions } from 'react-remote-control';

// Optional endpoint returning `{ iceServers }` with TURN credentials, set at
// build time (see the README's "TURN servers"). Without it: STUN only.
const turnUrl: string | undefined = import.meta.env.VITE_TURN_CREDENTIALS_URL;

async function iceServers(): Promise<RTCIceServer[]> {
	const res = await fetch(turnUrl!, { signal: AbortSignal.timeout(5000) });
	if (!res.ok) throw new Error(`TURN credentials: HTTP ${res.status}`);
	return (await res.json()).iceServers;
}

// Optional PeerJS broker (e.g. a self-hosted peerjs-server), set at build time as
// its address: absolute, or a path on this site. Without it: the public broker.
const brokerUrl: string | undefined = import.meta.env.VITE_PEER_SERVER_URL;

function peerServer(url: string): PeerServerOptions {
	const { protocol, hostname, port, pathname } = new URL(url, location.href);
	const secure = protocol === 'https:';
	return { host: hostname, port: port ? Number(port) : secure ? 443 : 80, path: pathname, secure };
}

// Module level, so it's one object for the app's lifetime.
const config: WebRTCConnectionOptions | undefined =
	turnUrl || brokerUrl
		? { ...(turnUrl && { iceServers }), ...(brokerUrl && { peerServer: peerServer(brokerUrl) }) }
		: undefined;

export default function App() {
	const [brightness, setBrightness] = useRcState('brightness', 50);
	const [hue, setHue] = useRcState('hue', 180);

	return (
		<>
			<RemoteControl config={config} />

			<main>
				<h1>react-remote-control demo</h1>
				<p className="hint">Open this page on another device (open the link or scan the QR in the top-right) to see state sync in action.</p>

				<div className="sliders">
					<label>
						<span>Brightness <strong>{brightness}</strong></span>
						<input type="range" min="0" max="100" value={brightness} onChange={(e) => setBrightness(e.target.valueAsNumber)} />
					</label>

					<label>
						<span>Hue <strong>{hue}°</strong></span>
						<input type="range" min="0" max="360" value={hue} onChange={(e) => setHue(e.target.valueAsNumber)} />
					</label>
				</div>

				<div className="swatch" style={{ background: `hsl(${hue}deg ${brightness}% 50%)` }}></div>
			</main>
		</>
	);
}
