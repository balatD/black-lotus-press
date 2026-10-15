import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
    main: {
        build: { rollupOptions: { input: { index: resolve('app/main/index.ts') } } }
    },
    preload: {
        build: {
            rollupOptions: {
                input: { index: resolve('app/preload/index.ts') },
                // Sandboxed preload scripts cannot be ES modules, and "type": "module" would make them one.
                output: { format: 'cjs', entryFileNames: '[name].cjs' }
            }
        }
    },
    renderer: {
        root: 'app/renderer',
        build: { rollupOptions: { input: { index: resolve('app/renderer/index.html') } } },
        plugins: [react()]
    }
});
