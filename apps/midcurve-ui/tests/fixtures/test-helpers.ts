/**
 * Test Helper Utilities
 *
 * Provides utility functions for common testing patterns.
 */

import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * Waits for the page to be fully loaded and hydrated
 *
 * @param page - Playwright page object
 */
export async function waitForPageReady(page: Page) {
  // Wait for Next.js to be ready
  await page.waitForLoadState('networkidle');
  await page.waitForLoadState('domcontentloaded');

  // Wait for React hydration to complete
  await page.waitForFunction(() => {
    return document.querySelector('[data-reactroot], [data-reactid]') !== null ||
           document.querySelector('#__next') !== null;
  }, { timeout: 10000 }).catch(() => {
    // Ignore if React markers not found (may use different structure)
  });
}

/**
 * Mocks an API endpoint with custom response
 *
 * @param page - Playwright page object
 * @param endpoint - API endpoint pattern
 * @param response - Response data to return
 * @param statusCode - HTTP status code (default: 200)
 */
export async function mockApiEndpoint(
  page: Page,
  endpoint: string,
  response: any,
  statusCode = 200
) {
  await page.route(endpoint, async (route) => {
    await route.fulfill({
      status: statusCode,
      contentType: 'application/json',
      body: JSON.stringify(response),
    });
  });
}

/**
 * Mocks multiple API endpoints at once
 *
 * @param page - Playwright page object
 * @param mocks - Array of endpoint mocks
 */
export async function mockApiEndpoints(
  page: Page,
  mocks: Array<{
    endpoint: string;
    response: any;
    statusCode?: number;
  }>
) {
  for (const mock of mocks) {
    await mockApiEndpoint(
      page,
      mock.endpoint,
      mock.response,
      mock.statusCode
    );
  }
}

/**
 * Takes a screenshot with a descriptive name in the test-results folder
 *
 * @param page - Playwright page object
 * @param name - Screenshot name (will be sanitized)
 */
export async function takeScreenshot(page: Page, name: string) {
  const sanitizedName = name.replace(/[^a-z0-9]/gi, '-').toLowerCase();
  await page.screenshot({
    path: `test-results/${sanitizedName}.png`,
    fullPage: true,
  });
}

/**
 * Verifies that an element contains specific text
 *
 * @param page - Playwright page object
 * @param selector - Element selector
 * @param expectedText - Expected text content
 */
export async function expectElementToContainText(
  page: Page,
  selector: string,
  expectedText: string
) {
  const element = page.locator(selector);
  await expect(element).toBeVisible();
  await expect(element).toContainText(expectedText);
}

/**
 * Clicks an element and waits for navigation
 *
 * @param page - Playwright page object
 * @param selector - Element selector to click
 */
export async function clickAndWaitForNavigation(
  page: Page,
  selector: string
) {
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle' }),
    page.locator(selector).click(),
  ]);
}

/**
 * Fills a form field and waits for any validation
 *
 * @param page - Playwright page object
 * @param selector - Input field selector
 * @param value - Value to fill
 */
export async function fillFormField(
  page: Page,
  selector: string,
  value: string
) {
  const input = page.locator(selector);
  await input.fill(value);
  await page.waitForTimeout(100); // Brief wait for validation
}

/**
 * Waits for a specific API request to complete
 *
 * @param page - Playwright page object
 * @param urlPattern - URL pattern to wait for
 * @param action - Action that triggers the request
 */
export async function waitForApiRequest(
  page: Page,
  urlPattern: string | RegExp,
  action: () => Promise<void>
) {
  const responsePromise = page.waitForResponse(urlPattern);
  await action();
  const response = await responsePromise;
  return response;
}

/**
 * Checks for console errors during test execution
 *
 * @param page - Playwright page object
 * @returns Array of console error messages
 */
export function captureConsoleErrors(page: Page): string[] {
  const errors: string[] = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      errors.push(msg.text());
    }
  });

  return errors;
}

/**
 * Verifies no console errors occurred
 *
 * @param errors - Array of captured console errors
 * @param allowedErrors - Array of error patterns to ignore
 */
export function expectNoConsoleErrors(
  errors: string[],
  allowedErrors: RegExp[] = []
) {
  const unexpectedErrors = errors.filter((error) => {
    return !allowedErrors.some((pattern) => pattern.test(error));
  });

  expect(unexpectedErrors).toHaveLength(0);
}
