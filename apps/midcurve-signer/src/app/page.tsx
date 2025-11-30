export default function Home() {
  return (
    <main style={{ padding: '2rem', fontFamily: 'system-ui, sans-serif' }}>
      <h1>Midcurve Signer API</h1>
      <p>This is an internal-only API service. No UI is provided.</p>
      <h2>Available Endpoints</h2>
      <ul>
        <li><code>GET /api/health</code> - Health check</li>
        <li><code>POST /api/wallets</code> - Create automation wallet</li>
        <li><code>GET /api/wallets/:address</code> - Get wallet details</li>
        <li><code>POST /api/sign/test-evm-wallet</code> - Test signing infrastructure</li>
        <li><code>POST /api/sign/erc20/approve</code> - Sign ERC-20 approve</li>
        <li><code>POST /api/sign/erc20/transfer</code> - Sign ERC-20 transfer</li>
        <li><code>POST /api/sign/uniswapv3/open-position</code> - Sign Uniswap V3 mint</li>
        <li><code>POST /api/sign/uniswapv3/close-position</code> - Sign Uniswap V3 burn</li>
        <li><code>POST /api/sign/uniswapv3/increase-liquidity</code> - Sign increase liquidity</li>
        <li><code>POST /api/sign/uniswapv3/decrease-liquidity</code> - Sign decrease liquidity</li>
        <li><code>POST /api/sign/uniswapv3/collect-fees</code> - Sign collect fees</li>
      </ul>
      <p style={{ marginTop: '2rem', color: '#666' }}>
        All endpoints require internal API key authentication via <code>X-Internal-API-Key</code> header.
      </p>
    </main>
  );
}
