import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryProvider } from './providers/QueryProvider';
import { Web3Provider } from './providers/Web3Provider';
import { AuthProvider } from './providers/AuthProvider';
import { Erc20TransferEventProvider } from './lib/events/erc20-transfer-event-context';

// Pages
import { HomePage } from './pages/HomePage';
import { DashboardPage } from './pages/DashboardPage';
import { PositionDetailPage } from './pages/PositionDetailPage';
import { StrategyDetailPage } from './pages/StrategyDetailPage';
import { NotificationsPage } from './pages/NotificationsPage';

// Automation
import { AutowalletPage } from './components/automation';

// Hyperliquid
import { HyperliquidWalletPage } from './components/hyperliquid';

export function App() {
  return (
    <QueryProvider>
      <AuthProvider>
        <Web3Provider>
          <Erc20TransferEventProvider>
            <BrowserRouter>
              <Routes>
                <Route path="/" element={<HomePage />} />
                <Route path="/dashboard" element={<DashboardPage />} />
                <Route
                  path="/positions/:protocol/:chain/:nftId"
                  element={<PositionDetailPage />}
                />
                <Route
                  path="/strategies/:strategyId"
                  element={<StrategyDetailPage />}
                />
                <Route
                  path="/automation/wallet"
                  element={<AutowalletPage />}
                />
                <Route
                  path="/hyperliquid/wallet"
                  element={<HyperliquidWalletPage />}
                />
                <Route
                  path="/notifications"
                  element={<NotificationsPage />}
                />
              </Routes>
            </BrowserRouter>
          </Erc20TransferEventProvider>
        </Web3Provider>
      </AuthProvider>
    </QueryProvider>
  );
}
