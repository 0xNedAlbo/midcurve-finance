import { Writable } from 'node:stream';
import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

import { createLogger } from './logger.js';

/**
 * Tests for the logger destination wiring.
 *
 * These exercise createLogger() rather than the exported `logger` singleton.
 * The singleton is built at import time from process.env, and under vitest
 * NODE_ENV is 'test' — so it resolves to level 'silent' on the stdout branch
 * and could demonstrate nothing about the development branch.
 *
 * Background: #94. pino filters twice — once at the logger, once per stream in
 * a multistream — and only the first was ever configured here.
 */

interface Sink {
  stream: Writable;
  records: () => Array<Record<string, unknown>>;
}

/**
 * An in-memory destination that collects the NDJSON pino writes to it.
 *
 * _write is synchronous, so a record is readable on the same tick as the
 * logger call that produced it.
 */
function createSink(): Sink {
  const chunks: string[] = [];

  const stream = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });

  return {
    stream,
    records: () =>
      chunks
        .join('')
        .split('\n')
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

function messages(sink: Sink): unknown[] {
  return sink.records().map((record) => record.msg);
}

describe('createLogger', () => {
  describe('development branch (multistream)', () => {
    it('writes a debug record to both destinations when the level is debug', () => {
      const stdout = createSink();
      const file = createSink();

      const logger = createLogger({
        nodeEnv: 'development',
        logLevel: 'debug',
        stdout: stdout.stream,
        openLogFile: () => file.stream,
      });

      logger.debug('debug probe');

      // The assertion that fails when the per-entry level is missing: pino's
      // multistream defaults an entry without a level to info (30), and a debug
      // record is 20, so it reaches neither destination.
      expect(messages(stdout)).toContain('debug probe');
      expect(messages(file)).toContain('debug probe');
    });

    it('writes an info record to both destinations when the level is debug', () => {
      const stdout = createSink();
      const file = createSink();

      const logger = createLogger({
        nodeEnv: 'development',
        logLevel: 'debug',
        stdout: stdout.stream,
        openLogFile: () => file.stream,
      });

      logger.info('info probe');

      expect(messages(stdout)).toContain('info probe');
      expect(messages(file)).toContain('info probe');
    });

    it('writes a debug record to neither destination when the level is info', () => {
      const stdout = createSink();
      const file = createSink();

      const logger = createLogger({
        nodeEnv: 'development',
        logLevel: 'info',
        stdout: stdout.stream,
        openLogFile: () => file.stream,
      });

      logger.debug('debug probe');
      logger.info('info probe');

      // Both directions matter: a fix that writes everything everywhere is not
      // a fix. LOG_LEVEL still has to be able to suppress debug.
      expect(messages(stdout)).toEqual(['info probe']);
      expect(messages(file)).toEqual(['info probe']);
    });

    it('preserves the level label formatter on both destinations', () => {
      const stdout = createSink();
      const file = createSink();

      const logger = createLogger({
        nodeEnv: 'development',
        logLevel: 'debug',
        stdout: stdout.stream,
        openLogFile: () => file.stream,
      });

      logger.debug('debug probe');

      // .claude/rules/dev-log-analysis.md depends on the level being a string
      // label rather than pino's default numeric level.
      expect(stdout.records().map((record) => record.level)).toContain('debug');
      expect(file.records().map((record) => record.level)).toContain('debug');
    });

    it('writes nothing to either destination when the level is silent', () => {
      const stdout = createSink();
      const file = createSink();

      const logger = createLogger({
        nodeEnv: 'development',
        logLevel: 'silent',
        stdout: stdout.stream,
        openLogFile: () => file.stream,
      });

      logger.debug('debug probe');
      logger.info('info probe');
      logger.error('error probe');

      // 'silent' is not a level pino's StreamEntry type admits, but multistream
      // maps it to Infinity (lib/multistream.js: streamLevels.silent).
      expect(messages(stdout)).toEqual([]);
      expect(messages(file)).toEqual([]);
    });
  });

  describe('non-development branch (stdout only)', () => {
    it('writes to stdout and never opens the log file', () => {
      const stdout = createSink();
      const openLogFile = vi.fn(() => createSink().stream);

      const logger = createLogger({
        nodeEnv: 'production',
        logLevel: 'debug',
        stdout: stdout.stream,
        openLogFile,
      });

      logger.debug('debug probe');

      expect(openLogFile).not.toHaveBeenCalled();
      expect(messages(stdout)).toContain('debug probe');
    });

    it('honours the level on the stdout branch', () => {
      const stdout = createSink();

      const logger = createLogger({
        nodeEnv: 'production',
        logLevel: 'info',
        stdout: stdout.stream,
        openLogFile: () => createSink().stream,
      });

      logger.debug('debug probe');
      logger.info('info probe');

      expect(messages(stdout)).toEqual(['info probe']);
    });
  });
});

describe('pino multistream defaults', () => {
  /**
   * This pins library behaviour, not ours.
   *
   * A multistream entry that supplies neither `level` nor `levelVal` is
   * assigned info (30) by lib/multistream.js add() — DEFAULT_INFO_LEVEL — and
   * write() stops at the first stream above the record's level. That default is
   * undocumented at the call site and is the entire cause of #94. If a future
   * pino changes it, these fail and whoever upgrades finds out here rather than
   * from five months of missing logs.
   */
  it('assigns info to a stream entry that omits a level', () => {
    const sink = createSink();

    const streams = pino.multistream([{ stream: sink.stream }]);

    expect(streams.minLevel).toBe(30);
  });

  it('drops a debug record on a stream entry that omits a level', () => {
    const sink = createSink();

    const logger = pino(
      { level: 'debug' },
      pino.multistream([{ stream: sink.stream }])
    );

    logger.debug('debug probe');
    logger.info('info probe');

    expect(messages(sink)).toEqual(['info probe']);
  });

  it('keeps a debug record on a stream entry that carries a level', () => {
    const sink = createSink();

    const logger = pino(
      { level: 'debug' },
      pino.multistream([{ level: 'debug', stream: sink.stream }])
    );

    logger.debug('debug probe');

    expect(messages(sink)).toEqual(['debug probe']);
  });
});
