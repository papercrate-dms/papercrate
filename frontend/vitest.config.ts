/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
    test: {
        globals: true,
        environment: 'jsdom',
        setupFiles: './tests/setup.ts',
        css: false,
        environmentOptions: {
            jsdom: {
                resources: 'usable',
            },
        },
        alias: {
            // Match webpack alias if any, or standard src mapping
            '@': path.resolve(__dirname, './src'),
        },
    },
    resolve: {
        alias: {
            // Fallback for direct imports if @ isn't used everywhere
            'react': path.resolve('./node_modules/react'),
        }
    }
});
