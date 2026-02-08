import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryProvider } from './providers/QueryProvider';
import { Web3Provider } from './providers/Web3Provider';
import { AuthProvider } from './providers/AuthProvider';
import { Erc20TransferEventProvider } from './lib/events/erc20-transfer-event-context';

// Pages
import { HomePage } from './pages/HomePage';
import { DashboardPage } from './pages/DashboardPage';
import { PositionDetailPage } from './pages/PositionDetailPage';
import { NotificationsPage } from './pages/NotificationsPage';
import { WizardExamplePage } from './pages/WizardExamplePage';
import { CreatePositionPage } from './pages/CreatePositionPage';
import { IncreaseDepositPage } from './pages/IncreaseDepositPage';
import { WithdrawPage } from './pages/WithdrawPage';

// Automation
import { AutowalletPage } from './components/automation';

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
                  path="/automation/wallet"
                  element={<AutowalletPage />}
                />
                <Route
                  path="/notifications"
                  element={<NotificationsPage />}
                />
                <Route
                  path="/wizard-example"
                  element={<WizardExamplePage />}
                />
                <Route
                  path="/positions/create"
                  element={<CreatePositionPage />}
                />
                <Route
                  path="/positions/increase/:protocol/:chain/:nftId"
                  element={<IncreaseDepositPage />}
                />
                <Route
                  path="/positions/withdraw/:protocol/:chain/:nftId"
                  element={<WithdrawPage />}
                />
              </Routes>
            </BrowserRouter>
          </Erc20TransferEventProvider>
        </Web3Provider>
      </AuthProvider>
    </QueryProvider>
  );
}
