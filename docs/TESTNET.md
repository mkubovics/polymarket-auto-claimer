# Testing on Mumbai Testnet

This guide walks you through testing the Polymarket Auto-Claimer on Polygon Mumbai testnet before using it on mainnet.

## Prerequisites

- MetaMask wallet configured for Mumbai testnet
- Test MATIC from a faucet
- Node.js 18+ installed

## Step 1: Configure MetaMask for Mumbai

Add Mumbai testnet to MetaMask:

- **Network Name**: Mumbai Testnet
- **RPC URL**: https://rpc-mumbai.maticvigil.com
- **Chain ID**: 80001
- **Currency Symbol**: MATIC
- **Block Explorer**: https://mumbai.polygonscan.com

## Step 2: Get Test MATIC

Get free test MATIC from faucets:

1. **Polygon Faucet**: https://faucet.polygon.technology/
2. **Alchemy Faucet**: https://mumbaifaucet.com/
3. **QuickNode Faucet**: https://faucet.quicknode.com/polygon/mumbai

You'll need at least 0.1 MATIC for testing.

## Step 3: Deploy a Test Gnosis Safe

Since Polymarket uses Gnosis Safe proxies, you'll need to create one on Mumbai:

1. Visit https://app.safe.global/
2. Switch to Mumbai network
3. Create a new Safe with your test wallet as owner
4. Note the Safe address - this is your PROXY_ADDRESS

## Step 4: Get Test USDC

Mumbai testnet USDC contract: `0xe11A86849d99F524cAC3E7A0Ec1241828e332C62`

You can get test USDC from:
- Deploy your own mock USDC contract
- Use existing test faucets that support USDC
- Ask in Polygon Discord for test tokens

## Step 5: Create Test Positions

Since there's no Polymarket UI on testnet, you'll need to create test positions manually:

```javascript
// test-position-creator.js
const { ethers } = require('ethers');

const CTF_ADDRESS = '0x7D8610E9567d2a6C9FBB66a99Fb1438587be9F0E';
const USDC_ADDRESS = '0xe11A86849d99F524cAC3E7A0Ec1241828e332C62';

async function createTestPosition() {
  const provider = new ethers.JsonRpcProvider('https://rpc-mumbai.maticvigil.com');
  const signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  
  // This would interact with CTF contract to create positions
  // For testing, you might need to deploy your own test market
  console.log('Test position creation logic here...');
}

createTestPosition().catch(console.error);
```

## Step 6: Configure the Claimer for Testnet

Create a `.env` file:

```env
# Your test wallet private key
PRIVATE_KEY=your_test_private_key_here

# Your Mumbai Gnosis Safe address
PROXY_ADDRESS=0x...your_safe_address

# Mumbai RPC
RPC_URL=https://rpc-mumbai.maticvigil.com

# Enable test mode
TEST_MODE=true
```

## Step 7: Run the Test

```bash
# Install dependencies
npm install

# Run on testnet
npm run test

# Or directly
TEST_MODE=true npm run claim
```

## Step 8: Verify Transactions

Check your transactions on Mumbai explorer:
https://mumbai.polygonscan.com/address/YOUR_ADDRESS

## Test Contracts

### Mumbai Testnet Addresses

- **CTF Contract**: `0x7D8610E9567d2a6C9FBB66a99Fb1438587be9F0E`
- **USDC Token**: `0xe11A86849d99F524cAC3E7A0Ec1241828e332C62`
- **Gnosis Safe Factory**: `0xa6B71E26C5e0845f74c812102Ca7114b6a896AB2`
- **Gnosis Safe L2**: `0x3E5c63644E683549055b9Be8653de26E0B4CD36E`

### Creating Mock Positions

For complete testing, you may need to:

1. Deploy a test prediction market
2. Create conditions using CTF
3. Split positions
4. Resolve the market
5. Test claiming

Example mock market creation:

```javascript
// deploy-test-market.js
async function deployTestMarket() {
  // 1. Prepare a question/condition
  const questionId = ethers.id("Will test event happen?");
  const outcomeSlotCount = 2; // Yes/No
  
  // 2. Call prepareCondition on CTF
  // 3. Split collateral into position tokens
  // 4. Resolve the condition
  // 5. Now you can test claiming
}
```

## Troubleshooting

### Common Issues

**"Wrong network" error**
- Ensure RPC_URL points to Mumbai
- Check TEST_MODE=true is set

**"Safe not found" error**
- Verify your Safe is deployed on Mumbai
- Check the address is correct

**"No positions to claim"**
- You need to create test positions first
- Check if markets are properly resolved

**Transaction failures**
- Ensure you have enough test MATIC
- Check contract addresses are correct
- Verify your Safe has the test USDC to claim

### Getting Help

- Polygon Discord: https://discord.gg/polygon
- Gnosis Safe Discord: https://discord.gg/gnosisSafe
- GitHub Issues: Open an issue in this repo

## Moving to Mainnet

Once testing is successful:

1. Remove `TEST_MODE=true` from `.env`
2. Update `RPC_URL` to Polygon mainnet
3. Use your real `PRIVATE_KEY` and `PROXY_ADDRESS`
4. Start with small claims first
5. Monitor transactions carefully

## Security Reminder

- **NEVER** share your mainnet private key
- **ALWAYS** test on testnet first
- **DOUBLE CHECK** addresses before running on mainnet
- **START SMALL** when moving to production