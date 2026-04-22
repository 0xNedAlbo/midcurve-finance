/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_WALLETCONNECT_PROJECT_ID: string;
  readonly VITE_ENABLE_DEV_CHAINS?: string;
  readonly VITE_ENABLE_LOCAL_CHAIN?: string;
  readonly VITE_RPC_URL_LOCAL?: string;
  readonly VITE_ENABLE_BURNER_WALLET?: string;
  readonly VITE_BURNER_PRIVATE_KEY?: `0x${string}`;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
