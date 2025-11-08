# CoinGecko Client Integration Tests

## Overview

Comprehensive integration tests for the CoinGecko API client that verify real API interactions, caching behavior, multi-chain support, and error handling.

## Test Coverage

### Test Suites (36 tests total)

1. **API Health and Connectivity** (3 tests)
   - Verifies connection to CoinGecko API
   - Validates response structure
   - Confirms platform filtering

2. **getAllTokens()** (3 tests)
   - Fetches real token list from API
   - Validates caching behavior
   - Finds specific known tokens

3. **findCoinByAddress()** (5 tests)
   - Discovers real tokens across chains (USDC, WETH, DAI)
   - Tests case-insensitive address matching
   - Validates null returns for non-existent tokens

4. **getCoinDetails()** (2 tests)
   - Fetches market data for real tokens
   - Validates error handling for invalid IDs

5. **getErc20EnrichmentData()** (3 tests)
   - End-to-end enrichment workflow
   - Symbol normalization
   - Error handling for missing tokens

6. **Cache Management** (3 tests)
   - Performance improvements from caching
   - Cache status reporting
   - Cache persistence across method calls

7. **Multi-Chain Support** (3 tests)
   - All 6 supported chains (Ethereum, Arbitrum, Base, BSC, Polygon, Optimism)
   - Cross-chain token discovery

8. **Error Handling** (3 tests)
   - Network error resilience
   - Meaningful error messages
   - Rate limiting handling

9. **Singleton Pattern** (4 tests)
   - Instance management
   - Cache behavior across instances

## Running the Tests

### Prerequisites

**No special setup required!** These tests use CoinGecko's free public API.

### Run All CoinGecko Integration Tests

```bash
# Watch mode (interactive)
npm run test:integration -- coingecko-client.integration.test

# Single run
npm run test:integration:run -- coingecko-client.integration.test

# With verbose output
npm run test:integration:run -- coingecko-client.integration.test --reporter=verbose
```

### Run Specific Test Suite

```bash
# Only cache management tests
npm run test:integration:run -- coingecko-client.integration.test -t "Cache Management"

# Only multi-chain support tests
npm run test:integration:run -- coingecko-client.integration.test -t "Multi-Chain"

# Only enrichment tests
npm run test:integration:run -- coingecko-client.integration.test -t "getErc20EnrichmentData"
```

## Rate Limiting

### CoinGecko Free API Limits

CoinGecko's free public API has the following rate limits:
- **~30 calls per minute** (varies by endpoint)
- **429 Too Many Requests** error when limit exceeded

### How Tests Handle Rate Limiting

The integration tests are designed to be **rate-limit resilient**:

1. **Cache Maximization**: Tests reuse cached data wherever possible
2. **Graceful Degradation**: Tests detect 429 errors and skip gracefully
3. **Warning Messages**: Rate limit warnings logged but don't fail tests

Example output when rate limited:
```
⚠️  Rate limited by CoinGecko API. This is expected for free tier.
⚠️  Rate limited - skipping test
```

### If You Hit Rate Limits

**Option 1: Wait and Retry**
```bash
# Wait 1-2 minutes, then retry
sleep 120 && npm run test:integration:run -- coingecko-client.integration.test
```

**Option 2: Run with Bail (Stop on First Failure)**
```bash
# Stops after first rate limit error
npm run test:integration:run -- coingecko-client.integration.test --bail
```

**Option 3: Use CoinGecko Pro API (Future)**
- Upgrade to CoinGecko Pro API for higher limits
- Add `COINGECKO_API_KEY` to `.env.test`
- Update client to support API key authentication

## Test Data

### Known Stable Tokens

Tests use real, well-known tokens with stable data:

| Token | Chain | Address | CoinGecko ID |
|-------|-------|---------|--------------|
| USDC | Ethereum (1) | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` | `usd-coin` |
| USDC | Arbitrum (42161) | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` | `usd-coin` |
| WETH | Ethereum (1) | `0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2` | `weth` |
| DAI | Ethereum (1) | `0x6B175474E89094C44Da98b954EedeAC495271d0F` | `dai` |

These tokens are chosen because they:
- Have high market caps (less likely to be delisted)
- Exist on multiple chains
- Have consistent naming across chains
- Are actively maintained by CoinGecko

## Test Expectations

### What Passes as Success

✅ **Pass**: API returns valid data
✅ **Pass**: Rate limit error with graceful skip (logs warning)
✅ **Pass**: Cache behavior verified locally
✅ **Pass**: Error handling works correctly

### What Counts as Failure

❌ **Fail**: Network error (not rate limiting)
❌ **Fail**: Malformed API response
❌ **Fail**: Type mismatch in returned data
❌ **Fail**: Unexpected exception

## CI/CD Considerations

### Running in CI Pipelines

```yaml
# GitHub Actions example
- name: Run CoinGecko Integration Tests
  run: npm run test:integration:run -- coingecko-client.integration.test --bail
  continue-on-error: true  # Optional: don't fail pipeline on rate limits
```

### Best Practices for CI

1. **Run Less Frequently**: Don't run on every commit
   - Run on PR merge to main
   - Run on scheduled cron (daily/weekly)

2. **Use Retry Logic**:
   ```yaml
   - name: Run CoinGecko Tests (with retry)
     uses: nick-invision/retry@v2
     with:
       timeout_minutes: 10
       max_attempts: 3
       retry_wait_seconds: 120
       command: npm run test:integration:run -- coingecko-client.integration.test
   ```

3. **Consider CoinGecko Pro**:
   - Higher rate limits for CI/CD
   - More reliable for automated testing
   - Add API key to GitHub Secrets

## Troubleshooting

### All Tests Failing with 429 Errors

**Problem**: Too many tests running too quickly

**Solution**:
```bash
# Wait 2 minutes
sleep 120

# Run tests again
npm run test:integration:run -- coingecko-client.integration.test
```

### Tests Pass Locally, Fail in CI

**Problem**: CI might have different IP/rate limits

**Solution**:
- Add retries to CI configuration
- Use `continue-on-error: true` for non-critical tests
- Consider CoinGecko Pro API key

### Specific Token Not Found

**Problem**: CoinGecko may have updated token data

**Solution**:
1. Verify token exists on CoinGecko website
2. Check if token address changed
3. Update `TEST_TOKENS` constants in test file

### Cache Tests Failing

**Problem**: Performance timing may vary on CI

**Solution**:
- Tests are designed to be lenient with timing
- Failures here usually indicate real caching issues
- Check if `clearCache()` is working correctly

## Performance

### Typical Test Execution

```
✓ CoinGeckoClient - Integration Tests (36 tests)
  API Health and Connectivity:         ~500ms (first call makes API request)
  getAllTokens():                      ~300ms (uses cache after first)
  findCoinByAddress():                 <50ms (cache hit)
  getCoinDetails():                    ~200ms (API call per test)
  getErc20EnrichmentData():            ~400ms (2 API calls per test)
  Cache Management:                    ~300ms
  Multi-Chain Support:                 <10ms (no API calls)
  Error Handling:                      ~300ms
  Singleton Pattern:                   <10ms (no API calls)

Total: ~2-5 seconds (depending on cache hits and rate limiting)
```

### With Rate Limiting

When rate limited, tests gracefully skip:
```
✓ Should connect to API (skipped - rate limited)
✓ Should find USDC (skipped - rate limited)
...

Tests: 12 passed, 24 skipped (36 total)
Duration: ~1 second
```

## Future Enhancements

### Planned Improvements

1. **API Key Support**
   - Add support for CoinGecko Pro API keys
   - Higher rate limits for testing

2. **Response Recording/Playback**
   - Record API responses for offline testing
   - Faster test execution without API calls

3. **Additional Chains**
   - Test more chains as support is added
   - Verify cross-chain consistency

4. **Market Data Validation**
   - Historical price data
   - Volume and liquidity metrics

## Resources

- [CoinGecko API Documentation](https://www.coingecko.com/en/api/documentation)
- [Rate Limiting Info](https://www.coingecko.com/en/api/pricing)
- [CoinGecko Pro API](https://www.coingecko.com/en/api/pricing)
- [Vitest Documentation](https://vitest.dev/)

## Questions?

Check the main [TESTING.md](../../TESTING.md) guide or the project [README](../../README.md).
