/**
 * WebSocket Polyfill Setup
 *
 * This file MUST be imported before any module that uses WebSocket
 * (like the Hyperliquid SDK). It sets up the `ws` package as a global
 * WebSocket implementation for Node.js environments that don't have
 * native WebSocket support (Node < 23).
 *
 * The Hyperliquid SDK tries several methods to load WebSocket:
 * 1. Checks for native WebSocket (Node 23+ only)
 * 2. Tries require('ws') - fails in ESM
 * 3. Tries globalThis.require('ws') - we can provide this!
 *
 * Usage: Import this file at the very top of your entry point:
 *   import './setup-websocket.js';
 */

import { createRequire } from 'module';
import WebSocket from 'ws';

// Create a require function for ESM that can be used by the SDK
const require = createRequire(import.meta.url);

// Make require available globally so the SDK can find it
(globalThis as unknown as { require: NodeRequire }).require = require;

// Also set WebSocket globally as a fallback
if (typeof globalThis.WebSocket === 'undefined') {
  (globalThis as unknown as { WebSocket: typeof WebSocket }).WebSocket = WebSocket;
}
