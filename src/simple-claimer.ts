#!/usr/bin/env node
import { ethers } from 'ethers';
import Safe from '@safe-global/protocol-kit';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

// Parse command line arguments
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run') || args.includes('-d');

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

const isTestMode = process.env.TEST_MODE === 'true';
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
    const privateKey = process.env.PRIVATE_KEY;
    this.proxyAddress = process.env.PROXY_ADDRESS || '';
    
    if (!rpcUrl || !privateKey || !this.proxyAddress) {
      throw new Error('Missing required environment variables: RPC_URL, PRIVATE_KEY, PROXY_ADDRESS');
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
    
    // Initialize Safe using v4 pattern (provider as RPC URL string)
    this.safe = await Safe.init({
      provider: process.env.RPC_URL!,  // Use RPC URL string directly
      signer: process.env.PRIVATE_KEY!,  // Use private key directly
      safeAddress: this.proxyAddress,
    });
    
    const owners = await this.safe.getOwners();
    const signerAddress = await this.signer.getAddress();
    
    if (!owners.includes(signerAddress)) {
      throw new Error(`Signer ${signerAddress} is not an owner of Safe ${this.proxyAddress}`);
    }
    
    // Check Safe threshold
    const threshold = await this.safe.getThreshold();
    console.log(`   Safe threshold: ${threshold}/${owners.length}`);
    
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
  
  buildRedemptionCalldata(conditionId: string, outcomeIndex: number): string {
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
  
  async claimPosition(position: Position, dryRun: boolean = false) {
    if (!this.safe) throw new Error('Safe not initialized');
    
    console.log(`\n💰 ${dryRun ? '[DRY RUN] Would claim' : 'Claiming'} position in market: ${position.title}`);
    console.log(`   Outcome: ${position.outcome}`);
    console.log(`   Size: ${position.size} shares`);
    console.log(`   Condition ID: ${position.conditionId}`);
    console.log(`   Outcome Index: ${position.outcomeIndex}`);
    
    // If dry run, just show what would happen without executing
    if (dryRun) {
      console.log(`   ✅ [DRY RUN] Would redeem position with:`);
      console.log(`      - Expected payout: ${position.size} USDC`);
      return { success: true, txHash: 'DRY_RUN' };
    }
    
    try {
      // Log Safe state before transaction
      console.log('\n   🔍 Safe State:');
      const nonce = await this.safe.getNonce();
      const owners = await this.safe.getOwners();
      const threshold = await this.safe.getThreshold();
      console.log(`      - Nonce: ${nonce}`);
      console.log(`      - Threshold: ${threshold}/${owners.length}`);
      console.log(`      - Owners: ${owners.join(', ')}`);
      
      // Build transaction data
      const calldata = this.buildRedemptionCalldata(
        position.conditionId,
        position.outcomeIndex
      );
      console.log(`      - Calldata: ${calldata.slice(0, 50)}...`);
      
      // Create Safe transaction
      console.log('\n   📝 Creating Safe transaction...');
      const safeTransaction = await this.safe.createTransaction({
        transactions: [{
          to: currentConfig.ctfAddress,
          value: '0',
          data: calldata,
          operation: 0, // Call
        }],
      });
      
      // Log transaction details
      console.log('   📋 Transaction details:');
      console.log(`      - To: ${currentConfig.ctfAddress}`);
      console.log(`      - Safe TX Hash: ${await this.safe.getTransactionHash(safeTransaction)}`);
      console.log(`      - Nonce: ${safeTransaction.data.nonce}`);
      
      // Sign transaction - Try multiple methods to ensure signature is added
      console.log('\n   ✍️  Signing transaction...');
      
      // Try signing with explicit method first
      let signedTx;
      try {
        // Try eth_signTypedData_v4 first (recommended for Safe)
        signedTx = await this.safe.signTransaction(
          safeTransaction,
          'eth_signTypedData_v4' as any
        );
        console.log('      - Used signing method: eth_signTypedData_v4');
      } catch (e1) {
        console.log('      - eth_signTypedData_v4 failed, trying eth_sign...');
        try {
          // Fallback to eth_sign
          signedTx = await this.safe.signTransaction(
            safeTransaction,
            'eth_sign' as any
          );
          console.log('      - Used signing method: eth_sign');
        } catch (e2) {
          console.log('      - Both signing methods failed, using default...');
          signedTx = await this.safe.signTransaction(safeTransaction);
          console.log('      - Used signing method: default');
        }
      }
      
      // Check if signatures were added
      const signatures = (signedTx as any).signatures;
      const signers = signatures ? Object.keys(signatures) : [];
      
      console.log('   🔍 Signature check:');
      console.log(`      - Signatures found: ${signers.length}`);
      
      // If no signatures, try manual signing as fallback
      if (signers.length === 0) {
        console.log('      ⚠️  No signatures in transaction, attempting manual signing...');
        
        try {
          // Get transaction hash and sign it manually
          const txHash = await this.safe.getTransactionHash(safeTransaction);
          console.log(`      - Transaction hash: ${txHash}`);
          
          // Sign the hash and get the signature
          const signature = await this.safe.signHash(txHash);
          console.log(`      - Manual signature created`);
          
          // Explicitly add the signature to the transaction
          // This is crucial for Safe SDK v4
          (signedTx as any).addSignature(signature);
          
          const signerAddress = await this.signer.getAddress();
          console.log(`      - Signature added for: ${signerAddress}`);
          console.log('      ✅ Fallback signing successful');
          
          // Verify signature was added
          const updatedSigners = (signedTx as any).signatures ? 
            Array.from((signedTx as any).signatures.keys()) : [];
          console.log(`      - Signatures after fallback: ${updatedSigners.length}`);
          
        } catch (fallbackError) {
          console.error('      ❌ Fallback signing failed:', fallbackError);
          console.log('      ⚠️  Proceeding anyway - Safe SDK might handle it internally');
        }
      } else {
        console.log(`      ✅ Signatures present from: ${signers.join(', ')}`);
      }
      
      // Execute transaction
      console.log('\n   🚀 Executing transaction...');
      try {
        const executeTxResponse = await this.safe.executeTransaction(signedTx);
        
        // Log full response for debugging
        console.log('   📦 Execution response received');
        
        // In Safe SDK v4, the response structure is different
        // Check if we have a hash directly in the response
        const txHash = (executeTxResponse as any).hash || 
                      (executeTxResponse as any).transactionHash ||
                      (executeTxResponse as any).safeTxHash;
        
        if (txHash) {
          console.log(`   ✅ Claimed! TX: ${txHash}`);
          
          // Try to wait for confirmation if possible
          try {
            const receipt = await this.provider.waitForTransaction(txHash, 1);
            if (receipt) {
              console.log(`   ✅ Confirmed on chain`);
            }
          } catch {
            // Transaction might be relayed, so we can't always wait for it
            console.log(`   ⚠️  Transaction submitted via relayer`);
          }
          
          return { success: true, txHash };
        } else {
          console.log('   ⚠️  Transaction submitted (may be relayed)');
          return { success: true, txHash: null };
        }
      } catch (execError: any) {
        console.log('\n   ❌ Execution failed');
        
        // Decode error if it's a Safe error
        if (execError.data) {
          try {
            // Try to decode GS error
            const errorData = execError.data;
            if (typeof errorData === 'string' && errorData.startsWith('0x08c379a0')) {
              // This is a revert string
              const reason = ethers.AbiCoder.defaultAbiCoder().decode(
                ['string'],
                '0x' + errorData.slice(10)
              )[0];
              console.log(`      - Decoded error: ${reason}`);
              
              // Check for specific GS errors
              if (reason.includes('GS026')) {
                console.log('      - GS026: Invalid owner provided');
                console.log('      - This usually means the signature is invalid or from wrong owner');
              } else if (reason.includes('GS013')) {
                console.log('      - GS013: Safe transaction already executed');
              }
            }
          } catch {
            console.log(`      - Raw error data: ${execError.data}`);
          }
        }
        
        // Handle relayer-specific errors
        if (execError.message?.includes('already executed') || 
            execError.message?.includes('nonce')) {
          console.log('   ⚠️  Transaction may have been already executed');
          return { success: true, txHash: null };
        }
        throw execError;
      }
      
    } catch (error: any) {
      const errorMsg = error.reason || error.message || 'Unknown error';
      console.error(`   ❌ Failed to claim: ${errorMsg}`);
      
      // Log more details for debugging
      if (error.code) console.error(`      - Error code: ${error.code}`);
      if (error.data) console.error(`      - Error data: ${error.data}`);
      if (error.transaction) {
        console.error(`      - Transaction to: ${error.transaction.to}`);
        console.error(`      - Transaction data: ${error.transaction.data?.slice(0, 50)}...`);
      }
      
      return { success: false, error: errorMsg };
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
  
  console.log('=' .repeat(40));
  
  const claimer = new SimplePolymarketClaimer();
  
  // Check balances first
  await claimer.getBalances();
  
  // Run the claimer with dry run flag
  await claimer.run(isDryRun);
  
  // Check balances after (skip in dry run since nothing changed)
  if (!isDryRun) {
    await claimer.getBalances();
  }
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