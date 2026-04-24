/**
 * Environment configuration for the MCP server.
 *
 * Read once at startup. Failure to provide MIDCURVE_API_KEY exits the process
 * before the stdio transport is connected so the user sees a clear error in
 * the Claude Desktop logs.
 */

const DEFAULT_API_URL = 'http://localhost:3001';
const DEFAULT_LOG_LEVEL = 'info';

export interface Env {
  apiKey: string;
  apiUrl: string;
  logLevel: string;
}

export function loadEnv(): Env {
  const apiKey = process.env.MIDCURVE_API_KEY;
  if (!apiKey) {
    throw new Error(
      'MIDCURVE_API_KEY is not set. Generate a key at /api-keys in the midcurve UI ' +
        'and pass it to the MCP server via the Claude Desktop config "env" block.'
    );
  }

  const apiUrl = (process.env.MIDCURVE_API_URL ?? DEFAULT_API_URL).replace(/\/$/, '');
  const logLevel = process.env.MIDCURVE_MCP_LOG_LEVEL ?? DEFAULT_LOG_LEVEL;

  return { apiKey, apiUrl, logLevel };
}
