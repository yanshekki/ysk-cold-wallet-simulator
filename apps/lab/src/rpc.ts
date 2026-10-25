import { bytesToHex } from './apdu';

const ETH_RPC = 'https://ethereum-sepolia-rpc.publicnode.com';
const SOL_RPC = 'https://api.devnet.solana.com';
const NEAR_RPC = 'https://rpc.testnet.near.org';

async function jsonRpc(url: string, method: string, params: unknown[]): Promise<unknown> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const body = (await response.json()) as { result?: unknown; error?: { message?: string } };
  if (body.error) {
    throw new Error(body.error.message ?? 'RPC error');
  }
  return body.result;
}

export async function broadcastSepolia(raw: Uint8Array): Promise<string> {
  const hash = await jsonRpc(ETH_RPC, 'eth_sendRawTransaction', [`0x${bytesToHex(raw)}`]);
  return typeof hash === 'string' ? hash : JSON.stringify(hash);
}

export async function solanaDevnetHealth(): Promise<string> {
  const result = await jsonRpc(SOL_RPC, 'getHealth', []);
  return typeof result === 'string' ? result : JSON.stringify(result);
}

export async function nearViewAccount(accountId: string): Promise<string> {
  const result = await jsonRpc(NEAR_RPC, 'query', [
    { request_type: 'view_account', finality: 'final', account_id: accountId },
  ]);
  if (result && typeof result === 'object' && 'amount' in result) {
    return `exists amount=${String((result as { amount: string }).amount)}`;
  }
  return JSON.stringify(result);
}

export const NEAR_FAUCET = 'https://testnet.help/en/nearfaucet/testnet';
