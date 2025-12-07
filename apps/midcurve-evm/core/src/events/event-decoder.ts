import type { Address, Hex, Log } from 'viem';
import { decodeAbiParameters } from 'viem';
import { LogLevel } from '../utils/logger.js';
import {
  EVENT_TOPICS,
  type DecodedEvent,
  type DecodeResult,
  type SubscriptionRequestedEvent,
  type UnsubscriptionRequestedEvent,
  type ActionRequestedEvent,
  type LogMessageEvent,
  type Erc20WithdrawRequestedEvent,
  type EthWithdrawRequestedEvent,
  type EthBalanceUpdateRequestedEvent,
} from './types.js';

/**
 * EventDecoder decodes Solidity events emitted by strategies during callback execution.
 *
 * Supported events:
 * - SubscriptionRequested(bytes32 indexed subscriptionType, bytes payload)
 * - UnsubscriptionRequested(bytes32 indexed subscriptionType, bytes payload)
 * - ActionRequested(bytes32 indexed actionType, bytes payload)
 * - LogMessage(uint8 indexed level, string message, bytes data)
 *
 * IMPORTANT: Logs should be decoded in order as emitted by the strategy.
 * Do NOT group by type - order matters for correct state transitions!
 */
export class EventDecoder {
  /**
   * Decode a single log entry
   * @param log The log entry from a transaction receipt
   * @returns The decoded event or an unknown log marker
   */
  decode(log: Log): DecodeResult {
    // Logs must have at least one topic (the event signature)
    if (!log.topics || log.topics.length === 0) {
      return { type: 'Unknown', log };
    }

    const topic0 = log.topics[0];

    switch (topic0) {
      case EVENT_TOPICS.SUBSCRIPTION_REQUESTED:
        return this.decodeSubscriptionRequested(log);

      case EVENT_TOPICS.UNSUBSCRIPTION_REQUESTED:
        return this.decodeUnsubscriptionRequested(log);

      case EVENT_TOPICS.ACTION_REQUESTED:
        return this.decodeActionRequested(log);

      case EVENT_TOPICS.LOG_MESSAGE:
        return this.decodeLogMessage(log);

      case EVENT_TOPICS.ERC20_WITHDRAW_REQUESTED:
        return this.decodeErc20WithdrawRequested(log);

      case EVENT_TOPICS.ETH_WITHDRAW_REQUESTED:
        return this.decodeEthWithdrawRequested(log);

      case EVENT_TOPICS.ETH_BALANCE_UPDATE_REQUESTED:
        return this.decodeEthBalanceUpdateRequested(log);

      default:
        return { type: 'Unknown', log };
    }
  }

  /**
   * Decode multiple logs in order
   * @param logs Array of logs from a transaction receipt
   * @returns Array of decoded events (unknown logs are filtered out)
   */
  decodeAll(logs: Log[]): DecodedEvent[] {
    const decoded: DecodedEvent[] = [];

    for (const log of logs) {
      const result = this.decode(log);
      if (result.type !== 'Unknown') {
        decoded.push(result);
      }
    }

    return decoded;
  }

  /**
   * Decode multiple logs in order, including unknown logs
   * @param logs Array of logs from a transaction receipt
   * @returns Array of decode results (including unknown)
   */
  decodeAllWithUnknown(logs: Log[]): DecodeResult[] {
    return logs.map((log) => this.decode(log));
  }

  /**
   * Decode SubscriptionRequested event
   * Event: SubscriptionRequested(bytes32 indexed subscriptionType, bytes payload)
   */
  private decodeSubscriptionRequested(log: Log): SubscriptionRequestedEvent {
    // topic[0] = event signature
    // topic[1] = indexed subscriptionType (bytes32)
    const subscriptionType = log.topics[1] as Hex;

    // Non-indexed payload is in the data field
    const [payload] = decodeAbiParameters(
      [{ name: 'payload', type: 'bytes' }],
      log.data as Hex
    );

    return {
      type: 'SubscriptionRequested',
      subscriptionType,
      payload: payload as Hex,
      log,
    };
  }

  /**
   * Decode UnsubscriptionRequested event
   * Event: UnsubscriptionRequested(bytes32 indexed subscriptionType, bytes payload)
   */
  private decodeUnsubscriptionRequested(
    log: Log
  ): UnsubscriptionRequestedEvent {
    // topic[0] = event signature
    // topic[1] = indexed subscriptionType (bytes32)
    const subscriptionType = log.topics[1] as Hex;

    // Non-indexed payload is in the data field
    const [payload] = decodeAbiParameters(
      [{ name: 'payload', type: 'bytes' }],
      log.data as Hex
    );

    return {
      type: 'UnsubscriptionRequested',
      subscriptionType,
      payload: payload as Hex,
      log,
    };
  }

  /**
   * Decode ActionRequested event
   * Event: ActionRequested(bytes32 indexed actionType, bytes payload)
   */
  private decodeActionRequested(log: Log): ActionRequestedEvent {
    // topic[0] = event signature
    // topic[1] = indexed actionType (bytes32)
    const actionType = log.topics[1] as Hex;

    // Non-indexed payload is in the data field
    const [payload] = decodeAbiParameters(
      [{ name: 'payload', type: 'bytes' }],
      log.data as Hex
    );

    return {
      type: 'ActionRequested',
      actionType,
      payload: payload as Hex,
      log,
    };
  }

  /**
   * Decode LogMessage event
   * Event: LogMessage(uint8 indexed level, string message, bytes data)
   */
  private decodeLogMessage(log: Log): LogMessageEvent {
    // topic[0] = event signature
    // topic[1] = indexed level (uint8, padded to 32 bytes)
    const levelHex = log.topics[1] as Hex;
    const level = parseInt(levelHex, 16) as LogLevel;

    // Non-indexed message and data are in the data field
    const [message, data] = decodeAbiParameters(
      [
        { name: 'message', type: 'string' },
        { name: 'data', type: 'bytes' },
      ],
      log.data as Hex
    );

    return {
      type: 'LogMessage',
      level,
      message: message as string,
      data: data as Hex,
      log,
    };
  }

  /**
   * Decode Erc20WithdrawRequested event
   * Event: Erc20WithdrawRequested(bytes32 indexed requestId, uint256 indexed chainId, address indexed token, uint256 amount, address recipient)
   */
  private decodeErc20WithdrawRequested(log: Log): Erc20WithdrawRequestedEvent {
    // topic[0] = event signature
    // topic[1] = indexed requestId (bytes32)
    // topic[2] = indexed chainId (uint256)
    // topic[3] = indexed token (address)
    const requestId = log.topics[1] as Hex;
    const chainId = BigInt(log.topics[2] as Hex);
    const token = ('0x' + (log.topics[3] as string).slice(26)) as Address;

    // Non-indexed amount and recipient are in the data field
    const [amount, recipient] = decodeAbiParameters(
      [
        { name: 'amount', type: 'uint256' },
        { name: 'recipient', type: 'address' },
      ],
      log.data as Hex
    );

    return {
      type: 'Erc20WithdrawRequested',
      requestId,
      chainId,
      token,
      amount: amount as bigint,
      recipient: recipient as Address,
      log,
    };
  }

  /**
   * Decode EthWithdrawRequested event
   * Event: EthWithdrawRequested(bytes32 indexed requestId, uint256 indexed chainId, uint256 amount, address recipient)
   */
  private decodeEthWithdrawRequested(log: Log): EthWithdrawRequestedEvent {
    // topic[0] = event signature
    // topic[1] = indexed requestId (bytes32)
    // topic[2] = indexed chainId (uint256)
    const requestId = log.topics[1] as Hex;
    const chainId = BigInt(log.topics[2] as Hex);

    // Non-indexed amount and recipient are in the data field
    const [amount, recipient] = decodeAbiParameters(
      [
        { name: 'amount', type: 'uint256' },
        { name: 'recipient', type: 'address' },
      ],
      log.data as Hex
    );

    return {
      type: 'EthWithdrawRequested',
      requestId,
      chainId,
      amount: amount as bigint,
      recipient: recipient as Address,
      log,
    };
  }

  /**
   * Decode EthBalanceUpdateRequested event
   * Event: EthBalanceUpdateRequested(bytes32 indexed requestId, uint256 indexed chainId)
   */
  private decodeEthBalanceUpdateRequested(
    log: Log
  ): EthBalanceUpdateRequestedEvent {
    // topic[0] = event signature
    // topic[1] = indexed requestId (bytes32)
    // topic[2] = indexed chainId (uint256)
    const requestId = log.topics[1] as Hex;
    const chainId = BigInt(log.topics[2] as Hex);

    return {
      type: 'EthBalanceUpdateRequested',
      requestId,
      chainId,
      log,
    };
  }
}
