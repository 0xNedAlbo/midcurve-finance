# Prisma Seed Script

This seed script creates test data for development and testing.

## What it creates

- **Test User**: "Test Testmann" (`test@midcurve.finance`)
- **Test Wallet**: `0x1234567890123456789012345678901234567890`
- **Test API Key**: `mc_test_1234567890abcdefghijklmnopqrstuvwxyz`

## Usage

### Run the seed script

```bash
npm run prisma:seed
```

### Automatic seeding

The seed script also runs automatically when you run:

```bash
npm run prisma:migrate dev
```

## Using the test API key

After seeding, you can use the API key to test authenticated endpoints:

```bash
# Example: Discover USDC token
curl -X POST http://localhost:3000/api/v1/tokens/erc20 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer mc_test_1234567890abcdefghijklmnopqrstuvwxyz" \
  -d '{
    "address": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    "chainId": 1
  }'

# Example: Search for tokens
curl "http://localhost:3000/api/v1/tokens/erc20/search?chainId=1&symbol=usd" \
  -H "Authorization: Bearer mc_test_1234567890abcdefghijklmnopqrstuvwxyz"
```

## Resetting the database

If you need to reset the database and re-run the seed:

```bash
# WARNING: This deletes all data!
npx prisma migrate reset

# This will:
# 1. Drop the database
# 2. Create a new database
# 3. Run all migrations
# 4. Run the seed script
```

## Test credentials

- **User ID**: `test-user-seed`
- **User Name**: Test Testmann
- **User Email**: test@midcurve.finance
- **Wallet Address**: 0x1234567890123456789012345678901234567890
- **API Key**: mc_test_1234567890abcdefghijklmnopqrstuvwxyz

**⚠️ Note**: These are test credentials. Never use them in production!
