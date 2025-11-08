/**
 * Basic Health Check and Navigation Tests
 *
 * Verifies that:
 * - Homepage loads successfully
 * - Basic navigation works
 * - No critical console errors
 * - Landing page displays correctly
 */

import { test, expect } from '@playwright/test';
import { captureConsoleErrors, expectNoConsoleErrors, waitForPageReady } from '../fixtures/test-helpers';

test.describe('Homepage and Basic Navigation', () => {
  test('should load homepage successfully', async ({ page }) => {
    const consoleErrors = captureConsoleErrors(page);

    await test.step('Navigate to homepage', async () => {
      await page.goto('/');
      await waitForPageReady(page);
    });

    await test.step('Verify page title', async () => {
      await expect(page).toHaveTitle(/Midcurve/);
    });

    await test.step('Verify Midcurve branding is visible', async () => {
      const heading = page.locator('h1:has-text("Midcurve")');
      await expect(heading).toBeVisible();
    });

    await test.step('Verify subtitle is visible', async () => {
      const subtitle = page.locator('text=Uniswap V3 Risk Management Platform');
      await expect(subtitle).toBeVisible();
    });

    await test.step('Check for console errors', async () => {
      // Allow common Next.js development warnings
      const allowedErrors = [
        /Download the React DevTools/i,
        /webpack-internal/i,
      ];
      expectNoConsoleErrors(consoleErrors, allowedErrors);
    });

    await test.step('Take screenshot of landing page', async () => {
      await page.screenshot({
        path: 'test-results/homepage-loaded.png',
        fullPage: true,
      });
    });
  });

  test('should display all landing page sections', async ({ page }) => {
    await page.goto('/');
    await waitForPageReady(page);

    await test.step('Verify hero section', async () => {
      const heroHeading = page.locator('h2:has-text("Manage Your Uniswap V3 Positions")');
      await expect(heroHeading).toBeVisible();
    });

    await test.step('Verify CTA buttons', async () => {
      const getStartedButton = page.locator('a:has-text("Get Started")');
      const signInButton = page.locator('a:has-text("Sign In")');

      await expect(getStartedButton).toBeVisible();
      await expect(signInButton).toBeVisible();
    });

    await test.step('Verify feature cards', async () => {
      const riskPlanningCard = page.locator('text=Risk-Aware Planning');
      const interactiveChartsCard = page.locator('text=Interactive Charts');
      const multiChainCard = page.locator('text=Multi-Chain Support');

      await expect(riskPlanningCard).toBeVisible();
      await expect(interactiveChartsCard).toBeVisible();
      await expect(multiChainCard).toBeVisible();
    });

    await test.step('Verify call to action section', async () => {
      const ctaHeading = page.locator('text=Ready to optimize your DeFi strategy?');
      await expect(ctaHeading).toBeVisible();
    });
  });

  test('should open sign in modal when clicking Sign In button', async ({ page }) => {
    await page.goto('/');
    await waitForPageReady(page);

    await test.step('Click Sign In button', async () => {
      const signInButton = page.locator('a:has-text("Sign In")').first();
      await signInButton.click();
    });

    await test.step('Verify URL contains modal parameter', async () => {
      await expect(page).toHaveURL(/modal=signin/);
    });

    await test.step('Take screenshot of sign in modal', async () => {
      // Wait for modal to appear
      await page.waitForTimeout(500);

      await page.screenshot({
        path: 'test-results/signin-modal.png',
        fullPage: true,
      });
    });
  });

  test('should open signup modal when clicking Get Started button', async ({ page }) => {
    await page.goto('/');
    await waitForPageReady(page);

    await test.step('Click Get Started button', async () => {
      const getStartedButton = page.locator('a:has-text("Get Started")').first();
      await getStartedButton.click();
    });

    await test.step('Verify URL contains modal parameter', async () => {
      await expect(page).toHaveURL(/modal=signup/);
    });

    await test.step('Take screenshot of signup modal', async () => {
      // Wait for modal to appear
      await page.waitForTimeout(500);

      await page.screenshot({
        path: 'test-results/signup-modal.png',
        fullPage: true,
      });
    });
  });

  test('should be responsive on mobile viewport', async ({ page }) => {
    await test.step('Set mobile viewport', async () => {
      await page.setViewportSize({ width: 375, height: 667 });
    });

    await test.step('Navigate to homepage', async () => {
      await page.goto('/');
      await waitForPageReady(page);
    });

    await test.step('Verify content is visible on mobile', async () => {
      const heading = page.locator('h1:has-text("Midcurve")');
      const subtitle = page.locator('text=Uniswap V3 Risk Management Platform');

      await expect(heading).toBeVisible();
      await expect(subtitle).toBeVisible();
    });

    await test.step('Take screenshot of mobile view', async () => {
      await page.screenshot({
        path: 'test-results/homepage-mobile.png',
        fullPage: true,
      });
    });
  });
});
