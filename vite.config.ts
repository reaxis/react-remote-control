import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Builds the playground (playground/), not the package (that's `npm run build`).
// BASE_PATH sets the folder it is served from, e.g. `/react-remote-control/`.
export default defineConfig({
	root: 'playground',
	base: process.env.BASE_PATH ?? '/',
	plugins: [react()],
	resolve: {
		alias: { 'react-remote-control': fileURLToPath(new URL('./src/index.ts', import.meta.url)) }
	},
	build: { outDir: '../build', emptyOutDir: true }
});
