#!/usr/bin/env node
import { ethers } from 'ethers';
import Safe from '@safe-global/protocol-kit';
import axios from 'axios';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

// ---------- Environment Loading Strategy ---------------------------------
// Allow keeping the sensitive .env file OUTSIDE the repository directory.
// Resolution priority (first existing wins unless --env-file explicitly provided):
//   1. --env-file <path> or --env-file=<path>
//   2. ENV_PATH environment variable (absolute or relative)
//   3. Parent directory of repo:  <repo_root>/../.env
//   4. Local repo root:           <repo_root>/.env
// We never overwrite already-defined process.env keys when loading additional files.

// Detect repository root (assumes script executed from repo root or dist directory)
const executionCwd = process.cwd();
// If running from dist (e.g., repo/dist) move one level up to get repo root.
let repoRoot = executionCwd;
if (path.basename(executionCwd) === 'dist') {
  repoRoot = path.resolve(executionCwd, '..');
}

// Parse potential --env-file flag early (raw argv read below as well, but we need it here)
const earlyArgv = process.argv.slice(2);
let explicitEnvFile: string | undefined;
const envFileIdx = earlyArgv.findIndex(a => a === '--env-file' || a.startsWith('--env-file='));
if (envFileIdx !== -1) {
  const token = earlyArgv[envFileIdx];
  if (token.includes('=')) {
    explicitEnvFile = token.split('=')[1];
  } else if (earlyArgv[envFileIdx + 1]) {
    explicitEnvFile = earlyArgv[envFileIdx + 1];
  }
  if (explicitEnvFile && !path.isAbsolute(explicitEnvFile)) {
    explicitEnvFile = path.resolve(executionCwd, explicitEnvFile);
  }
}

const parentEnvPath = path.resolve(repoRoot, '..', '.env');
const localEnvPath = path.resolve(repoRoot, '.env');
const envPathFromVar = process.env.ENV_PATH ? (path.isAbsolute(process.env.ENV_PATH) ? process.env.ENV_PATH : path.resolve(executionCwd, process.env.ENV_PATH)) : undefined;

const candidateEnvPaths: string[] = [];
if (explicitEnvFile) candidateEnvPaths.push(explicitEnvFile);
if (envPathFromVar && !candidateEnvPaths.includes(envPathFromVar)) candidateEnvPaths.push(envPathFromVar);
// Only prioritize parent .env before local .env if not explicitly overridden:
if (!explicitEnvFile) {
  if (fs.existsSync(parentEnvPath)) candidateEnvPaths.push(parentEnvPath);
  if (fs.existsSync(localEnvPath)) candidateEnvPaths.push(localEnvPath);
} else {
  // If explicit file given but we still want to allow fallback if it doesn't exist
  if (fs.existsSync(parentEnvPath) && parentEnvPath !== explicitEnvFile) candidateEnvPaths.push(parentEnvPath);
  if (fs.existsSync(localEnvPath) && localEnvPath !== explicitEnvFile) candidateEnvPaths.push(localEnvPath);
}

let loadedEnvFile: string | undefined;
for (const p of candidateEnvPaths) {
  if (fs.existsSync(p)) {
    dotenv.config({ path: p, override: false });
    loadedEnvFile = p;
    break; // stop after first successful load
  }
}

if (!loadedEnvFile) {
  // Final fallback: try default dotenv behavior if nothing found
  const result = dotenv.config();
  if (result.parsed) loadedEnvFile = path.resolve(executionCwd, '.env (default resolution)');
}

if (loadedEnvFile) {
  console.log(`🔐 Loaded environment variables from: ${loadedEnvFile}`);
} else {
  console.warn('⚠️  No .env file found (proceeding with existing environment variables).');
}

// Parse command line arguments (after env load so flags don't affect dotenv resolution now)
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run') || args.includes('-d');

// Loop / scheduling options
// --loop : run forever (default 60m interval unless overridden)
// --interval <minutes> OR --interval=<minutes> : customize interval
// Environment fallback: LOOP_INTERVAL_MINUTES
const wantsLoop = args.includes('--loop');
let intervalMinutes: number | undefined;
const intervalFlagIndex = args.findIndex((a: string) => a === '--interval' || a.startsWith('--interval='));
if (intervalFlagIndex !== -1) {
  const token = args[intervalFlagIndex];
  if (token.includes('=')) {
    const val = token.split('=')[1];
    const parsed = Number(val);
    if (!Number.isNaN(parsed) && parsed > 0) intervalMinutes = parsed;
  } else if (args[intervalFlagIndex + 1]) {
    const parsed = Number(args[intervalFlagIndex + 1]);
    if (!Number.isNaN(parsed) && parsed > 0) intervalMinutes = parsed;
  }
}
if (!intervalMinutes) {
  const envInterval = process.env.LOOP_INTERVAL_MINUTES;
  if (envInterval && !Number.isNaN(Number(envInterval)) && Number(envInterval) > 0) {
    intervalMinutes = Number(envInterval);
  }
}
if (wantsLoop && !intervalMinutes) {
  intervalMinutes = 60; // default 60 minutes
}

// Guard: if user supplied interval without --loop, enable loop implicitly
if (!wantsLoop && intervalMinutes) {
  console.log(`ℹ️  Interval specified (${intervalMinutes}m) without --loop flag; enabling loop mode.`);
}

const loopMode = wantsLoop || !!intervalMinutes;
if (intervalMinutes && intervalMinutes < 1) {
  console.warn('⚠️  Interval < 1 minute not allowed, setting to 1.');
  intervalMinutes = 1;
}

// Configuration
const config = {
  // Polygon Mainnet
  mainnet: {
    chainId: 137,
    ctfAddress: '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045',
    usdcAddress: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
    polymarketApi: 'https://data-api.polymarket.com',
  },
  // Mumbai Testnet
  testnet: {
    chainId: 80001,
    ctfAddress: '0x7D8610E9567d2a6C9FBB66a99Fb1438587be9F0E',
    usdcAddress: '0xe11A86849d99F524cAC3E7A0Ec1241828e332C62',
    polymarketApi: 'https://data-api-testnet.polymarket.com',
  },
};

const isTestMode = false; // Disabled test mode - always use mainnet
const currentConfig = isTestMode ? config.testnet : config.mainnet;

interface Position {
  proxyWallet: string;
  asset: string;
  conditionId: string;
  size: number;
  avgPrice: number;
  initialValue: number;
  currentValue: number;
  cashPnl: number;
  percentPnl: number;
  totalBought: number;
  realizedPnl: number;
  percentRealizedPnl: number;
  curPrice: number;
  redeemable: boolean;
  mergeable: boolean;
  title: string;
  slug: string;
  icon: string;
  eventSlug: string;
  outcome: string;
  outcomeIndex: number;
  oppositeOutcome: string;
  oppositeAsset: string;
  endDate: string;
  negativeRisk: boolean;
}

class SimplePolymarketClaimer {
  private provider: ethers.JsonRpcProvider;
  private signer: ethers.Wallet;
  private safe?: Safe;
  private proxyAddress: string;
  
  constructor() {
    const rpcUrl = process.env.RPC_URL;
    const privateKey = process.env.PK; // renamed from PRIVATE_KEY
    this.proxyAddress = process.env.POLYMARKET_PROXY_ADDRESS || '';
    
    if (!rpcUrl || !privateKey || !this.proxyAddress) {
      throw new Error('Missing required environment variables: RPC_URL, PK, POLYMARKET_PROXY_ADDRESS');
    }
    
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    this.signer = new ethers.Wallet(privateKey, this.provider);
  }
  
  async initialize() {
    console.log('🔧 Initializing claimer...');
    
    // Verify network
    const network = await this.provider.getNetwork();
    if (network.chainId !== BigInt(currentConfig.chainId)) {
      throw new Error(`Wrong network. Expected chain ${currentConfig.chainId}, got ${network.chainId}`);
    }
    
    // Verify contract addresses exist on-chain
    const ctfCode = await this.provider.getCode(currentConfig.ctfAddress);
    const usdcCode = await this.provider.getCode(currentConfig.usdcAddress);
    
    if (ctfCode === '0x' || ctfCode.length < 10) {
      throw new Error(`CTF contract not found at ${currentConfig.ctfAddress}`);
    }
    if (usdcCode === '0x' || usdcCode.length < 10) {
      throw new Error(`USDC contract not found at ${currentConfig.usdcAddress}`);
    }
    
    // Verify proxy is a contract
    const proxyCode = await this.provider.getCode(this.proxyAddress);
    if (proxyCode === '0x' || proxyCode.length < 10) {
      throw new Error(`No Safe contract found at ${this.proxyAddress}. Is this a valid Gnosis Safe proxy?`);
    }
    
    // Try to initialize Safe - handle both standard Gnosis Safes and Polymarket custom proxies
    const signerAddress = await this.signer.getAddress();
    // Try to detect Safe type
    
    try {
      // First try standard Gnosis Safe initialization
      this.safe = await Safe.init({
        provider: process.env.RPC_URL!,  // Use RPC URL string directly
        signer: process.env.PK!,  // Use private key (PK) directly
        safeAddress: this.proxyAddress,
      });
      
      const owners = await this.safe.getOwners();
      const threshold = await this.safe.getThreshold();
      
      if (!owners.includes(signerAddress)) {
        throw new Error(`Signer ${signerAddress} is not an owner of Safe ${this.proxyAddress}`);
      }
      
      console.log(`   Safe threshold: ${threshold}/${owners.length}`);
      console.log(`   ✅ Standard Gnosis Safe detected`);
      
    } catch (error) {
      console.log(`   ⚠️  Standard Safe init failed, trying Polymarket proxy mode...`);
      console.log(`   Error: ${(error as any)?.shortMessage || (error as any)?.message || error}`);
      
      // Fallback: treat as Polymarket custom proxy
      this.safe = undefined;
      
      // Basic validation that the proxy contract exists and signer can interact
      try {
        // Check if signer can call basic functions on the proxy
        const balance = await this.provider.getBalance(this.proxyAddress);
        console.log(`   ✅ Polymarket proxy detected (balance: ${ethers.formatEther(balance)} MATIC)`);
        console.log(`   ✅ Signer address: ${signerAddress}`);
      } catch (proxyError) {
        throw new Error(`Failed to interact with proxy contract: ${(proxyError as any)?.message || proxyError}`);
      }
    }
    
    console.log(`✅ Connected to ${isTestMode ? 'Mumbai Testnet' : 'Polygon Mainnet'}`);
    console.log(`✅ Safe initialized: ${this.proxyAddress}`);
    console.log(`✅ Signer: ${signerAddress}`);
    console.log(`✅ Contracts verified`);
  }
  
  async fetchRedeemablePositions(): Promise<Position[]> {
    console.log('🔍 Fetching redeemable positions...');
    
    // IMPORTANT: Positions are held in the proxy wallet, not the EOA
    const url = `${currentConfig.polymarketApi}/positions`;
    
    try {
      const response = await axios.get(url, {
        params: {
          user: this.proxyAddress.toLowerCase(),  // Use proxy address, not EOA!
          // Remove redeemable filter - it's unreliable and sometimes excludes winning positions
          limit: 500,  // Increase limit to get all positions
        },
        headers: {
          'User-Agent': 'Polymarket-Auto-Claimer/1.0',
          'Accept': 'application/json',
        },
      });
      
      const positions = response.data as Position[];
      console.log(`📊 Total positions fetched: ${positions.length}`);
      
      // Filter for actually claimable positions
      // Only claim winning positions where curPrice = 1 and redeemable = true
      const claimable = positions.filter(pos => {
        // Must be marked as redeemable
        if (!pos.redeemable) return false;
        
        // Must have shares to redeem
        if (pos.size <= 0) return false;
        
        // Must be a winning position (curPrice = 1)
        // Losing positions (curPrice = 0) don't have USDC to claim
        if (pos.curPrice !== 1) {
          return false;
        }
        
        // Optional: Filter for recently resolved markets (last 48 hours)
        // Uncomment to enable date filtering:
        /*
        if (pos.endDate) {
          const endDate = new Date(pos.endDate);
          const now = new Date();
          const hoursAgo = (now.getTime() - endDate.getTime()) / (1000 * 60 * 60);
          
          // Skip very old resolved markets
          if (hoursAgo > 48) return false;
        }
        */
        
        return true;
      });
      
      // Log statistics
      const redeemableCount = positions.filter(p => p.redeemable).length;
      const winningCount = positions.filter(p => p.curPrice === 1).length;
      const losingCount = positions.filter(p => p.curPrice === 0).length;
      
      console.log(`📊 Found ${redeemableCount} positions marked redeemable`);
      console.log(`📊 Found ${winningCount} winning positions (curPrice = 1)`);
      console.log(`📊 Found ${losingCount} losing positions (curPrice = 0)`);
      console.log(`✅ Found ${claimable.length} claimable winning positions`);
      
      return claimable;
      
    } catch (error) {
      console.error('❌ Failed to fetch positions:', error);
      return [];
    }
  }
  
  buildRedemptionCalldata(conditionId: string, outcomeIndex: number, negativeRisk: boolean, size: number): string {
    if (negativeRisk) {
      // For negative risk markets, use the Neg Risk Adapter
      const negRiskInterface = new ethers.Interface([
        'function redeemPositions(bytes32 conditionId, uint256[] amounts)',
      ]);
      
      // For neg risk, we need to specify amounts for both outcomes
      // We're redeeming the winning outcome, so set the appropriate amount
      const amounts = outcomeIndex === 0 
        ? [ethers.parseUnits(size.toString(), 6), 0n] // Yes outcome
        : [0n, ethers.parseUnits(size.toString(), 6)]; // No outcome
      
      return negRiskInterface.encodeFunctionData('redeemPositions', [
        conditionId,
        amounts,
      ]);
    } else {
      // Regular markets use CTF contract
      const indexSet = 1n << BigInt(outcomeIndex);
      
      const ctfInterface = new ethers.Interface([
        'function redeemPositions(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, uint256[] indexSets)',
      ]);
      
      return ctfInterface.encodeFunctionData('redeemPositions', [
        currentConfig.usdcAddress,
        ethers.ZeroHash,
        conditionId,
        [indexSet],
      ]);
    }
  }
  
  async claimViaGnosisSafe(position: Position): Promise<{success: boolean; txHash?: string; error?: string}> {
    if (!this.safe) throw new Error('Safe not initialized');
    
    try {
      // Build transaction data
      const calldata = this.buildRedemptionCalldata(
        position.conditionId,
        position.outcomeIndex,
        position.negativeRisk,
        position.size
      );
      
      // Determine target contract based on market type
      const targetAddress = position.negativeRisk 
        ? '0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296' // NEG_RISK_ADAPTER_ADDRESS
        : currentConfig.ctfAddress;
      
      // Create Safe transaction
      const safeTransaction = await this.safe.createTransaction({
        transactions: [{
          to: targetAddress,
          value: '0',
          data: calldata,
          operation: 0, // Call
        }],
      });
      
      // Sign and execute via Safe SDK
      const signedTx = await this.safe.signTransaction(safeTransaction);
      const executeTxResponse = await this.safe.executeTransaction(signedTx);
      
      const txHash = (executeTxResponse as any).hash || 
                    (executeTxResponse as any).transactionHash ||
                    (executeTxResponse as any).safeTxHash;
      
      if (txHash) {
        console.log(`   ✅ Claimed via Gnosis Safe! TX: ${txHash}`);
        return { success: true, txHash };
      } else {
        return { success: true, txHash: undefined };
      }
      
    } catch (error: any) {
      const errorMsg = error.reason || error.message || 'Unknown error';
      console.error(`   ❌ Gnosis Safe claim failed: ${errorMsg}`);
      return { success: false, error: errorMsg };
    }
  }

  async claimViaPolymarketProxy(position: Position): Promise<{success: boolean; txHash?: string; error?: string}> {
    try {
      console.log('\n   🔍 Using Polymarket Proxy Wallet Factory');
      
      // Check if EOA has gas funds first
      const signerAddress = await this.signer.getAddress();
      const balance = await this.provider.getBalance(signerAddress);
      const balanceEth = ethers.formatEther(balance);
      
      console.log(`      - EOA MATIC balance: ${balanceEth}`);
      
      if (balance === 0n) {
        console.log('   ⚠️  No MATIC for gas fees in EOA');
        console.log('   💡 You need to add some MATIC to your EOA address for gas fees');
        console.log(`   💡 Send 0.01-0.1 MATIC to: ${signerAddress}`);
        return { 
          success: false, 
          error: `No MATIC for gas fees. Send MATIC to ${signerAddress}` 
        };
      }
      
      // Use Polymarket's Proxy Wallet Factory pattern
      const PROXY_WALLET_FACTORY = "0xaB45c5A4B0c941a2F231C04C3f49182e1A254052";
      const NEG_RISK_ADAPTER = "0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296";
      
      // Build redemption calldata
      const calldata = this.buildRedemptionCalldata(
        position.conditionId,
        position.outcomeIndex,
        position.negativeRisk,
        position.size
      );
      
      // Determine target contract based on market type
      const targetAddress = position.negativeRisk ? NEG_RISK_ADAPTER : currentConfig.ctfAddress;
      const marketType = position.negativeRisk ? 'Neg Risk Adapter' : 'CTF';
      
      console.log('\n   📝 Creating Proxy Factory transaction...');
      console.log(`      - Proxy Wallet (Safe): ${this.proxyAddress}`);
      console.log(`      - Target (${marketType}): ${targetAddress}`);
      console.log(`      - Market Type: ${position.negativeRisk ? 'Negative Risk' : 'Regular'}`);
      console.log(`      - Signer (EOA): ${signerAddress} pays gas`);
      
      // Proxy Factory ABI (minimal)
      const proxyFactoryAbi = [
        {
          "constant": false,
          "inputs": [
            {
              "components": [
                { "name": "typeCode", "type": "uint8" },
                { "name": "to", "type": "address" },
                { "name": "value", "type": "uint256" },
                { "name": "data", "type": "bytes" }
              ],
              "name": "calls",
              "type": "tuple[]"
            }
          ],
          "name": "proxy",
          "outputs": [{ "name": "returnValues", "type": "bytes[]" }],
          "payable": true,
          "stateMutability": "payable",
          "type": "function"
        }
      ];
      
      const factory = new ethers.Contract(PROXY_WALLET_FACTORY, proxyFactoryAbi, this.signer);
      
      // Build the proxy transaction
      const proxyTxn = {
        to: targetAddress,
        typeCode: 1, // Call type
        data: calldata,
        value: 0,
      };
      
      console.log(`   📡 Sending transaction through Proxy Factory...`);
      const tx = await factory.proxy([proxyTxn]);
      
      console.log(`   📡 Transaction sent: ${tx.hash}`);
      console.log(`   ⏳ Waiting for confirmation...`);
      
      const receipt = await tx.wait();
      
      if (!receipt) {
        console.log(`   ❌ Transaction receipt is null`);
        return { success: false, error: 'Transaction receipt is null' };
      }
      
      if (receipt.status === 0) {
        console.log(`   ❌ Transaction reverted!`);
        return { success: false, error: 'Transaction reverted', txHash: tx.hash };
      }
      
      console.log(`   ✅ Claimed successfully! TX: ${tx.hash}`);
      console.log(`   ✅ Confirmed in block ${receipt.blockNumber}`);
      
      return { success: true, txHash: tx.hash };
      
    } catch (error: any) {
      const errorMsg = error.reason || error.message || 'Unknown error';
      console.error(`   ❌ Proxy factory claim failed: ${errorMsg}`);
      
      if (errorMsg.includes('insufficient funds')) {
        console.log('   💡 Add MATIC to your EOA for gas fees');
        console.log(`   💡 Send 0.01-0.1 MATIC to: ${await this.signer.getAddress()}`);
      }
      
      return { success: false, error: errorMsg };
    }
  }
  
  async claimPosition(position: Position, dryRun: boolean = false): Promise<{success: boolean; txHash?: string; error?: string}> {
    console.log(`\n💰 ${dryRun ? '[DRY RUN] Would claim' : 'Claiming'} position in market: ${position.title}`);
    console.log(`   Outcome: ${position.outcome}`);
    console.log(`   Size: ${position.size} shares`);
    console.log(`   Condition ID: ${position.conditionId}`);
    console.log(`   Outcome Index: ${position.outcomeIndex}`);
    
    if (dryRun) {
      console.log(`   ✅ [DRY RUN] Would redeem position with:`);
      console.log(`      - Expected payout: ${position.size} USDC`);
      return { success: true, txHash: 'DRY_RUN' };
    }
    
    // Handle both standard Safe and Polymarket proxy modes
    if (this.safe) {
      return this.claimViaGnosisSafe(position);
    } else {
      return this.claimViaPolymarketProxy(position);
    }
  }

  async run(dryRun: boolean = false) {
    try {
      await this.initialize();
      
      const positions = await this.fetchRedeemablePositions();
      
      if (positions.length === 0) {
        console.log('\n✨ No positions to claim');
        return;
      }
      
      if (dryRun) {
        console.log(`\n🔍 DRY RUN MODE - Found ${positions.length} claimable positions:`);
        console.log('=' .repeat(60));
        
        let totalValue = 0;
        for (const position of positions) {
          totalValue += position.size;
        }
        
        console.log(`\n📊 Total claimable value: ${totalValue.toFixed(2)} USDC`);
      } else {
        console.log(`\n🚀 Starting to claim ${positions.length} positions...`);
      }
      
      let successCount = 0;
      let failCount = 0;
      
      for (const position of positions) {
        const result = await this.claimPosition(position, dryRun);
        
        if (result.success) {
          successCount++;
        } else {
          failCount++;
        }
        
        // Small delay between claims (skip in dry run)
        if (!dryRun) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
      
      console.log('\n📈 Summary:');
      if (dryRun) {
        console.log(`   🔍 [DRY RUN] Would claim: ${successCount} positions`);
        const totalValue = positions.reduce((sum, pos) => sum + pos.size, 0);
        console.log(`   💰 Total value: ${totalValue.toFixed(2)} USDC`);
      } else {
        console.log(`   ✅ Successful: ${successCount}`);
        console.log(`   ❌ Failed: ${failCount}`);
        console.log(`   📊 Total: ${positions.length}`);
      }
      
    } catch (error) {
      console.error('\n🚨 Fatal error:', error);
      process.exit(1);
    }
  }
  
  async getBalances() {
    const usdcInterface = new ethers.Interface([
      'function balanceOf(address) view returns (uint256)',
    ]);
    
    const usdcContract = new ethers.Contract(
      currentConfig.usdcAddress,
      usdcInterface,
      this.provider
    );
    
    // Get USDC balance in Safe
    const balance = await usdcContract.balanceOf(this.proxyAddress);
    const formattedBalance = ethers.formatUnits(balance, 6);
    
    // Get MATIC balance in MetaMask/EOA (pays for gas)
    const signerAddress = await this.signer.getAddress();
    const eoaMaticBalance = await this.provider.getBalance(signerAddress);
    const formattedEoaMatic = ethers.formatEther(eoaMaticBalance);
    
    // Get MATIC balance in Safe (informational only)
    const safeMaticBalance = await this.provider.getBalance(this.proxyAddress);
    const formattedSafeMatic = ethers.formatEther(safeMaticBalance);
    
    console.log(`\n💰 Wallet Balances:`);
    console.log(`   📱 MetaMask/EOA (${signerAddress.slice(0, 6)}...${signerAddress.slice(-4)}):`);
    console.log(`      ⛽ MATIC: ${formattedEoaMatic} (pays gas fees)`);
    console.log(`   🔐 Safe (${this.proxyAddress.slice(0, 6)}...${this.proxyAddress.slice(-4)}):`);
    console.log(`      💵 USDC: ${formattedBalance}`);
    console.log(`      ⛽ MATIC: ${formattedSafeMatic} (not needed for claims)`);
  }
}

// Main execution
async function main() {
  console.log('🎯 Polymarket Auto-Claimer');

  if (isDryRun) {
    console.log('🔍 DRY RUN MODE ENABLED');
  }
  if (loopMode) {
    console.log(`🔁 LOOP MODE ENABLED (every ${intervalMinutes} minute${intervalMinutes === 1 ? '' : 's'})`);
  }

  console.log('='.repeat(40));

  const claimer = new SimplePolymarketClaimer();

  // Graceful shutdown controls
  let shouldExit = false;
  const shutdown = (signal: string) => {
    console.log(`\n🛑 Received ${signal}, will exit after current iteration.`);
    shouldExit = true;
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  const runOnce = async (iteration: number) => {
    console.log(`\n▶️  Iteration #${iteration} @ ${new Date().toISOString()}`);
    try {
      await claimer.run(isDryRun);
      await claimer.getBalances();
      if (!isDryRun) {
        await claimer.getBalances();
      }
    } catch (err) {
      console.error('Iteration error:', err);
    }
  };

  let iteration = 1;
  await runOnce(iteration);
  if (!loopMode) return; // single-run mode

  // Drift-compensated scheduling
  const intervalMs = (intervalMinutes || 60) * 60 * 1000;
  let nextPlanned = Date.now() + intervalMs;

  while (!shouldExit) {
    const now = Date.now();
    let delay = nextPlanned - now;
    if (delay < 0) delay = 0; // if we overran, run immediately
    const jitter = Math.floor(Math.random() * 3000); // 0–3s jitter
    console.log(`⏱ Waiting ${(delay / 1000).toFixed(0)}s + ${jitter}ms jitter until next iteration...`);
    await new Promise(r => setTimeout(r, delay + jitter));
    if (shouldExit) break;
    iteration += 1;
    await runOnce(iteration);
    nextPlanned += intervalMs; // schedule the subsequent run based on original cadence
  }

  console.log('👋 Exiting loop mode. Bye.');
}

// Handle direct execution
if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export default SimplePolymarketClaimer;
export { SimplePolymarketClaimer, Position };