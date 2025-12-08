import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import type { Address, Hex } from 'viem';
import type pino from 'pino';
import { WithdrawalApi } from './withdrawal-api.js';
import type { SignedWithdrawRequest, FundingResult } from './types.js';

/**
 * Default port for the withdrawal API server
 */
const DEFAULT_PORT = 8547;

/**
 * Simple HTTP server for withdrawal API requests.
 *
 * Provides a single endpoint:
 * POST /withdraw - Submit a signed withdrawal request
 *
 * Request body:
 * {
 *   message: WithdrawRequestMessage,
 *   signature: Hex
 * }
 *
 * Response:
 * {
 *   success: boolean,
 *   requestId?: Hex,
 *   txHash?: Hex,
 *   errorMessage?: string
 * }
 */
export class WithdrawalServer {
  private server: ReturnType<typeof createServer> | null = null;

  constructor(
    private withdrawalApi: WithdrawalApi,
    private logger: pino.Logger,
    private port: number = DEFAULT_PORT
  ) {}

  /**
   * Start the HTTP server
   */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => {
        this.handleRequest(req, res);
      });

      this.server.on('error', (error) => {
        this.logger.error({ error }, 'Withdrawal server error');
        reject(error);
      });

      this.server.listen(this.port, () => {
        this.logger.info({ port: this.port }, 'Withdrawal server started');
        resolve();
      });
    });
  }

  /**
   * Stop the HTTP server
   */
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.logger.info('Withdrawal server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Handle incoming HTTP requests
   */
  private async handleRequest(
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle preflight requests
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Only accept POST to /withdraw
    if (req.method !== 'POST' || req.url !== '/withdraw') {
      this.sendError(res, 404, 'Not found');
      return;
    }

    try {
      // Parse request body
      const body = await this.parseBody(req);
      const request = this.validateRequest(body);

      this.logger.info(
        {
          strategyAddress: request.message.strategyAddress,
          chainId: request.message.chainId.toString(),
          token: request.message.token,
          amount: request.message.amount.toString(),
        },
        'Received withdrawal request'
      );

      // Process the withdrawal
      const result = await this.withdrawalApi.processWithdrawRequest(request);

      // Send response
      this.sendSuccess(res, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error({ error: message }, 'Failed to process withdrawal request');
      this.sendError(res, 400, message);
    }
  }

  /**
   * Parse request body as JSON
   */
  private parseBody(req: IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
      let body = '';

      req.on('data', (chunk) => {
        body += chunk.toString();
      });

      req.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch {
          reject(new Error('Invalid JSON'));
        }
      });

      req.on('error', reject);
    });
  }

  /**
   * Validate the request body structure
   */
  private validateRequest(body: unknown): SignedWithdrawRequest {
    if (!body || typeof body !== 'object') {
      throw new Error('Request body must be an object');
    }

    const obj = body as Record<string, unknown>;

    if (!obj.message || typeof obj.message !== 'object') {
      throw new Error('Missing or invalid message field');
    }

    if (!obj.signature || typeof obj.signature !== 'string') {
      throw new Error('Missing or invalid signature field');
    }

    const message = obj.message as Record<string, unknown>;

    // Validate message fields
    const requiredFields = [
      'strategyAddress',
      'chainId',
      'token',
      'amount',
      'recipient',
      'nonce',
      'expiry',
    ];

    for (const field of requiredFields) {
      if (message[field] === undefined) {
        throw new Error(`Missing required field: message.${field}`);
      }
    }

    // Convert string numbers to bigint
    return {
      message: {
        strategyAddress: message.strategyAddress as Address,
        chainId: BigInt(message.chainId as string),
        token: message.token as Address,
        amount: BigInt(message.amount as string),
        recipient: message.recipient as Address,
        nonce: BigInt(message.nonce as string),
        expiry: BigInt(message.expiry as string),
      },
      signature: obj.signature as Hex,
    };
  }

  /**
   * Send a success response
   */
  private sendSuccess(res: ServerResponse, result: FundingResult): void {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  }

  /**
   * Send an error response
   */
  private sendError(res: ServerResponse, status: number, message: string): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        success: false,
        errorMessage: message,
      })
    );
  }

  /**
   * Get the port the server is listening on
   */
  getPort(): number {
    return this.port;
  }
}
