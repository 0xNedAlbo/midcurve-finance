import { describe, it, expect, beforeEach } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { updatePositionInListCache } from "../update-position-in-list-cache";
import type {
  ListPositionsResponse,
  UpdateUniswapV3PositionData,
} from "@midcurve/api-shared";

describe("updatePositionInListCache", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
  });

  it("updates position in single cache", () => {
    // Setup: Cache with position
    const cacheData: ListPositionsResponse = {
      data: [
        {
          id: "pos-1",
          protocol: "uniswapv3" as const,
          currentValue: "1000",
          realizedPnl: "100",
          unrealizedPnl: "50",
          collectedFees: "25",
          unClaimedFees: "10",
          config: { chainId: 1, nftId: 123456 },
        } as any,
        {
          id: "pos-2",
          protocol: "uniswapv3" as const,
          currentValue: "2000",
          config: { chainId: 1, nftId: 789012 },
        } as any,
      ],
      pagination: {
        total: 2,
        limit: 20,
        offset: 0,
        hasMore: false,
      },
      meta: {
        timestamp: new Date().toISOString(),
        filters: {
          status: "active" as const,
          sortBy: "totalApr" as const,
          sortDirection: "desc" as const,
        },
      },
    };

    queryClient.setQueryData(["positions", "list", {}], cacheData);

    // Execute: Update pos-1
    const updatedPosition: UpdateUniswapV3PositionData = {
      id: "pos-1",
      protocol: "uniswapv3" as const,
      currentValue: "1500", // Changed
      realizedPnl: "150", // Changed
      unrealizedPnl: "75", // Changed
      collectedFees: "50", // Changed
      unClaimedFees: "20", // Changed
      config: { chainId: 1, nftId: 123456 },
    } as any;

    const count = updatePositionInListCache(queryClient, updatedPosition);

    // Assert: Position updated
    expect(count).toBe(1);
    const updated = queryClient.getQueryData<ListPositionsResponse>([
      "positions",
      "list",
      {},
    ]);
    expect(updated?.data[0].currentValue).toBe("1500");
    expect(updated?.data[0].realizedPnl).toBe("150");
    expect(updated?.data[0].collectedFees).toBe("50");
    // Other position unchanged
    expect(updated?.data[1].id).toBe("pos-2");
    expect(updated?.data[1].currentValue).toBe("2000");
  });


  it("updates multiple caches", () => {
    // Setup: Two different list caches
    const cache1: ListPositionsResponse = {
      data: [
        {
          id: "pos-1",
          protocol: "uniswapv3" as const,
          currentValue: "1000",
          config: { chainId: 1, nftId: 123456 },
        } as any,
      ],
      pagination: {
        total: 1,
        limit: 20,
        offset: 0,
        hasMore: false,
      },
      meta: {
        timestamp: new Date().toISOString(),
        filters: {
          status: "active" as const,
          sortBy: "totalApr" as const,
          sortDirection: "desc" as const,
        },
      },
    };

    const cache2: ListPositionsResponse = {
      data: [
        {
          id: "pos-1",
          protocol: "uniswapv3" as const,
          currentValue: "1000",
          config: { chainId: 1, nftId: 123456 },
        } as any,
      ],
      pagination: {
        total: 1,
        limit: 20,
        offset: 0,
        hasMore: false,
      },
      meta: {
        timestamp: new Date().toISOString(),
        filters: {
          status: "all" as const,
          sortBy: "createdAt" as const,
          sortDirection: "asc" as const,
        },
      },
    };

    queryClient.setQueryData(
      ["positions", "list", { status: "active" }],
      cache1
    );
    queryClient.setQueryData(["positions", "list", { status: "all" }], cache2);

    // Execute
    const updatedPosition: UpdateUniswapV3PositionData = {
      id: "pos-1",
      protocol: "uniswapv3" as const,
      currentValue: "1500",
      config: { chainId: 1, nftId: 123456 },
    } as any;

    const count = updatePositionInListCache(queryClient, updatedPosition);

    // Assert: Both updated
    expect(count).toBe(2);

    const updated1 = queryClient.getQueryData<ListPositionsResponse>([
      "positions",
      "list",
      { status: "active" },
    ]);
    expect(updated1?.data[0].currentValue).toBe("1500");

    const updated2 = queryClient.getQueryData<ListPositionsResponse>([
      "positions",
      "list",
      { status: "all" },
    ]);
    expect(updated2?.data[0].currentValue).toBe("1500");
  });

  it("skips cache if position not found", () => {
    const cacheData: ListPositionsResponse = {
      data: [
        {
          id: "pos-2",
          protocol: "uniswapv3" as const,
          currentValue: "2000",
          config: { chainId: 1, nftId: 789012 },
        } as any, // Different position
      ],
      pagination: {
        total: 1,
        limit: 20,
        offset: 0,
        hasMore: false,
      },
      meta: {
        timestamp: new Date().toISOString(),
        filters: {
          status: "active" as const,
          sortBy: "totalApr" as const,
          sortDirection: "desc" as const,
        },
      },
    };

    queryClient.setQueryData(["positions", "list", {}], cacheData);

    const updatedPosition: UpdateUniswapV3PositionData = {
      id: "pos-1", // Different ID
      protocol: "uniswapv3" as const,
      currentValue: "1500",
      config: { chainId: 1, nftId: 123456 },
    } as any;

    const count = updatePositionInListCache(queryClient, updatedPosition);

    expect(count).toBe(0); // No caches updated

    // Original cache unchanged
    const unchanged = queryClient.getQueryData<ListPositionsResponse>([
      "positions",
      "list",
      {},
    ]);
    expect(unchanged?.data[0].id).toBe("pos-2");
    expect(unchanged?.data[0].currentValue).toBe("2000");
  });

  it("handles empty cache data gracefully", () => {
    const cacheData: ListPositionsResponse = {
      data: [],
      pagination: {
        total: 0,
        limit: 20,
        offset: 0,
        hasMore: false,
      },
      meta: {
        timestamp: new Date().toISOString(),
        filters: {
          status: "active" as const,
          sortBy: "totalApr" as const,
          sortDirection: "desc" as const,
        },
      },
    };

    queryClient.setQueryData(["positions", "list", {}], cacheData);

    const updatedPosition: UpdateUniswapV3PositionData = {
      id: "pos-1",
      protocol: "uniswapv3" as const,
      currentValue: "1500",
      config: { chainId: 1, nftId: 123456 },
    } as any;

    const count = updatePositionInListCache(queryClient, updatedPosition);

    expect(count).toBe(0); // No update
  });

  it("handles undefined cache data gracefully", () => {
    // No cache data set

    const updatedPosition: UpdateUniswapV3PositionData = {
      id: "pos-1",
      protocol: "uniswapv3" as const,
      currentValue: "1500",
      config: { chainId: 1, nftId: 123456 },
    } as any;

    const count = updatePositionInListCache(queryClient, updatedPosition);

    expect(count).toBe(0); // No error, no update
  });
});
