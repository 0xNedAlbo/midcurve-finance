# Shared Module

This directory contains common code shared across all Midcurve Finance projects:
- **API** (Next.js on Vercel)
- **UI** (Frontend application)
- **Workers** (Background job processors)

## Purpose

The `shared` module provides a single source of truth for:
- Type definitions and interfaces

## Structure

```
shared/
└── types/         # TypeScript type definitions and interfaces
```

## Future Migration

This directory is planned to be extracted into a separate repository (`@midcurve/shared`) to be consumed as an independent package across all projects.

## Guidelines

1. **Keep it pure**: Code here should have minimal dependencies
2. **Framework agnostic**: Should work in Node.js, browser, and edge runtimes
3. **Well-typed**: All exports should have proper TypeScript types
4. **Well-tested**: Add tests for critical shared logic
5. **Documented**: Document complex utilities and types

## Usage Example

```typescript
// In API, UI, or Workers
import { Position } from '@midcurve/services/shared';

const position: Position = { /* ... */ };
```
