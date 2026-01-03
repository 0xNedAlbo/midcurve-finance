/**
 * Type declarations for solc Solidity compiler
 */

declare module 'solc' {
  interface Source {
    content: string;
  }

  interface Sources {
    [fileName: string]: Source;
  }

  interface OptimizerSettings {
    enabled: boolean;
    runs: number;
  }

  interface OutputSelection {
    [file: string]: {
      [contract: string]: string[];
    };
  }

  interface Settings {
    optimizer?: OptimizerSettings;
    evmVersion?: string;
    outputSelection: OutputSelection;
  }

  interface SolcInput {
    language: 'Solidity';
    sources: Sources;
    settings: Settings;
  }

  interface SolcError {
    component: string;
    formattedMessage: string;
    message: string;
    severity: 'error' | 'warning';
    type: string;
  }

  interface BytecodeOutput {
    object: string;
    opcodes?: string;
    sourceMap?: string;
  }

  interface EVMOutput {
    bytecode: BytecodeOutput;
    deployedBytecode?: BytecodeOutput;
  }

  interface ABIParameter {
    name: string;
    type: string;
    indexed?: boolean;
    internalType?: string;
  }

  interface ABIEntry {
    type: 'function' | 'constructor' | 'event' | 'error' | 'fallback' | 'receive';
    name?: string;
    inputs?: ABIParameter[];
    outputs?: ABIParameter[];
    stateMutability?: 'pure' | 'view' | 'nonpayable' | 'payable';
    anonymous?: boolean;
  }

  interface ContractOutput {
    abi: ABIEntry[];
    evm: EVMOutput;
  }

  interface Contracts {
    [fileName: string]: {
      [contractName: string]: ContractOutput;
    };
  }

  interface SolcOutput {
    errors?: SolcError[];
    contracts?: Contracts;
  }

  /**
   * Compile Solidity source code
   * @param input JSON string of SolcInput
   * @returns JSON string of SolcOutput
   */
  function compile(input: string): string;

  /**
   * Get the version of the solc compiler
   * @returns Version string
   */
  function version(): string;

  export = { compile, version };
}
