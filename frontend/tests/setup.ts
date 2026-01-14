import '@testing-library/jest-dom';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Cleanup after each test case (e.g. clearing jsdom)
afterEach(() => {
    cleanup();
});

// Mock URL and other browser APIs if needed
if (!global.URL.createObjectURL) {
    global.URL.createObjectURL = () => 'mock-url';
}
