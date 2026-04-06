import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryProvider } from './providers/QueryProvider';
import { ConfigProvider, useConfig } from './providers/ConfigProvider';
import { Web3Provider } from './providers/Web3Provider';
import { AuthProvider } from './providers/AuthProvider';
import { Erc20TransferEventProvider } from './lib/events/erc20-transfer-event-context';

// Pages
import { HomePage } from './pages/HomePage';
import { DashboardPage } from './pages/DashboardPage';
import { PositionDetailPage } from './pages/PositionDetailPage';
import { VaultPositionDetailPage } from './pages/VaultPositionDetailPage';
import { NotificationsPage } from './pages/NotificationsPage';
import { WizardExamplePage } from './pages/WizardExamplePage';
import { CreatePositionPage } from './pages/CreatePositionPage';
import { IncreaseDepositPage } from './pages/IncreaseDepositPage';
import { WithdrawPage } from './pages/WithdrawPage';
import { RiskTriggersPage } from './pages/RiskTriggersPage';
import { SetupWizardPage } from './pages/SetupWizardPage';
import { SystemConfigPage } from './pages/SystemConfigPage';

export function App() {
  return (
    <QueryProvider>
      <ConfigProvider>
        <ConfigGate />
      </ConfigProvider>
    </QueryProvider>
  );
}

/**
 * Gates the main app behind the config wizard.
 * Shows a loading spinner while config status is being fetched,
 * the setup wizard if unconfigured, or the full app if configured.
 */
function ConfigGate() {
  const { status } = useConfig();

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-slate-600 border-t-blue-500" />
      </div>
    );
  }

  if (status === 'unconfigured') {
    return <SetupWizardPage />;
  }

  return (
    <Web3Provider>
      <AuthProvider>
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
                path="/positions/uniswapv3-vault/:chain/:vaultAddress"
                element={<VaultPositionDetailPage />}
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
              <Route
                path="/positions/triggers/:protocol/:chain/:nftId"
                element={<RiskTriggersPage />}
              />
              <Route path="/system-config" element={<SystemConfigPage />} />
              <Route path="/setup" element={<SetupWizardPage />} />
            </Routes>
          </BrowserRouter>
        </Erc20TransferEventProvider>
      </AuthProvider>
    </Web3Provider>
  );
}
