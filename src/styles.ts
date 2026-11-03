/**
 * Styles for `<RemoteControl />`. Rendered as a React 19 `<style href precedence>`,
 * which React hoists into `<head>` once, however many components render it,
 * and includes in server-rendered HTML. Every class is `rc-` prefixed, as
 * nothing scopes them.
 */
export const STYLES: string = `
.rc-anchor {
	position: fixed;
	top: 1rem;
	right: 1rem;
	z-index: 10;
}

.rc-trigger {
	display: flex;
	align-items: center;
	gap: 0.35rem;
	padding: 0.4rem 0.65rem;
	background: #fff;
	border: 1px solid #ddd;
	border-radius: 8px;
	cursor: pointer;
	box-shadow: 0 1px 4px rgba(0,0,0,0.08);
	transition: box-shadow 0.15s;
}

.rc-trigger:hover { box-shadow: 0 2px 8px rgba(0,0,0,0.12); }

.rc-trigger-dot {
	width: 8px;
	height: 8px;
	border-radius: 50%;
	display: inline-block;
}

.rc-trigger-dot.rc-connected    { background: #28a745; }
.rc-trigger-dot.rc-awaiting     { background: #aaa; }
.rc-trigger-dot.rc-disconnected { background: #ffc107; }
.rc-trigger-dot.rc-error        { background: #dc3545; }

.rc-trigger-role {
	font-size: 0.65rem;
	font-weight: 700;
	font-family: system-ui, sans-serif;
	color: #888;
	letter-spacing: 0.04em;
}

.rc-trigger-label {
	font-size: 0.8rem;
	font-family: monospace;
	color: #333;
}

.rc-trigger-count {
	font-size: 0.8rem;
	font-family: monospace;
	color: #aaa;
}

.rc-trigger-spinner {
	display: inline-block;
	width: 12px;
	height: 12px;
	border: 2px solid #e0e0e0;
	border-top-color: #555;
	border-radius: 50%;
	animation: rc-spin 0.7s linear infinite;
}

.rc-popover {
	position: fixed;
	inset: unset;
	top: 3.5rem;
	right: 1rem;
	width: 280px;
	max-height: calc(100dvh - 6.5rem);
	overflow-y: auto;
	padding: 1rem;
	background: #fff;
	color: #222;
	border: 1px solid #ddd;
	border-radius: 10px;
	box-shadow: 0 4px 20px rgba(0,0,0,0.12);
	flex-direction: column;
	gap: 0.75rem;
	margin: 0;
	font-family: system-ui, sans-serif;
	font-size: 0.95rem;
}

.rc-popover:popover-open { display: flex; }

/* Without the Popover API. Kept apart from the rule above: a browser that
   doesn't know :popover-open drops the whole rule it appears in. */
.rc-popover.rc-fallback { display: none; }
.rc-popover.rc-fallback.rc-open { display: flex; }

.rc-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 0.5rem;
}

.rc-title {
	margin: 0;
	font-size: 1.25rem;
}

.rc-qr {
	width: 240px;
	height: 240px;
	display: block;
	align-self: center;
}

.rc-peer-id {
	flex: 1;
	display: flex;
	align-items: center;
	gap: 0.4rem;
	font-family: monospace;
	font-size: 0.7rem;
	color: #555;
	background: #f5f5f5;
	border: 1px solid #e0e0e0;
	border-radius: 6px;
	padding: 0.4rem 0.4rem 0.4rem 0.6rem;
}

.rc-peer-id-text {
	flex: 1;
	word-break: break-all;
}

.rc-field-row {
	display: flex;
	align-items: center;
	gap: 0.5rem;
}

.rc-field-label {
	width: 1.75rem;
	flex-shrink: 0;
	font-size: 0.7rem;
	font-weight: 600;
	color: #888;
	text-transform: uppercase;
	letter-spacing: 0.05em;
	text-align: right;
}

.rc-copy {
	flex-shrink: 0;
	border: 1px solid #d0d0d0;
	cursor: pointer;
	width: 2rem;
	aspect-ratio: 1 / 1;
	border-radius: 4px;
	line-height: 1;
	transition: color 0.1s, background 0.1s, border-color 0.1s;
	align-self: flex-start;
	background-color: #fff;
	background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 12 12' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M7.5 10v1.5h-6v-8h1.5M10.5 2.5v6h-6v-8h4z' fill='none' stroke='%23000' /%3E%3C/svg%3E");
	background-size: 60%;
	background-position: center;
	background-repeat: no-repeat;
}

.rc-copy.rc-copied {
	background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 12 12' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1.5 5.5l3.5 3.5l5.5 -5.5' fill='none' stroke='%23000' /%3E%3C/svg%3E");
}

.rc-copy:hover {
	color: #333;
	background-color: #f0f0f0;
	border-color: #aaa;
}

.rc-divider {
	border: none;
	border-top: 1px solid #e8e8e8;
	margin: 0;
}

.rc-connect-row {
	display: flex;
	gap: 0.5rem;
	align-items: center;
}

.rc-input {
	flex: 1;
	font-family: monospace;
	font-size: 0.85rem;
	border: 1px solid #ccc;
	border-radius: 6px;
	padding: 0.5rem 0.75rem;
	width: 100%;
	box-sizing: border-box;
}

.rc-input:focus { outline: none; border-color: #888; }

.rc-remotes {
	display: flex;
	flex-direction: column;
	gap: 0.4rem;
}

.rc-remotes-label {
	font-size: 0.8rem;
	font-weight: 600;
	color: #888;
	text-transform: uppercase;
	letter-spacing: 0.05em;
}

.rc-remotes-list {
	list-style: none;
	padding: 0;
	margin: 0;
	display: flex;
	flex-wrap: wrap;
	gap: 0.35rem;
}

.rc-remotes-list li {
	display: flex;
	align-items: center;
	gap: 0.25rem;
	font-family: monospace;
	font-size: 0.8rem;
	background: #e8f4e8;
	color: #155724;
	border-radius: 4px;
	padding: 0.2rem 0.35rem 0.2rem 0.5rem;
}

.rc-kick {
	background: none;
	border: none;
	cursor: pointer;
	color: #155724;
	font-size: 0.7rem;
	line-height: 1;
	padding: 0.1rem 0.15rem;
	border-radius: 3px;
	opacity: 0.5;
	transition: opacity 0.1s;
}

.rc-kick:hover { opacity: 1; }

.rc-badge {
	display: inline-block;
	padding: 0.3rem 0.75rem;
	border-radius: 4px;
	font-size: 0.85rem;
	font-weight: 600;
	margin: 0;
}

.rc-badge.rc-disconnected { background: #fff3cd; color: #856404; }
.rc-badge.rc-error        { background: #f8d7da; color: #721c24; }

.rc-spinner {
	width: 28px;
	height: 28px;
	border: 3px solid #e0e0e0;
	border-top-color: #555;
	border-radius: 50%;
	animation: rc-spin 0.7s linear infinite;
}

.rc-btn {
	padding: 0.6rem 1.25rem;
	border: none;
	border-radius: 6px;
	font-size: 0.95rem;
	cursor: pointer;
	align-self: flex-start;
	transition: opacity 0.15s;
	background: #e8e8e8;
	color: #333;
}

.rc-btn:hover { background: #ddd; }
.rc-btn.rc-btn-sm { padding: 0.35rem 0.75rem; font-size: 0.8rem; }
.rc-btn:disabled { opacity: 0.4; cursor: default; }

.rc-hint {
	color: #666;
	font-size: 0.9rem;
	margin: 0;
}

@keyframes rc-spin {
	to { transform: rotate(360deg); }
}
`;
