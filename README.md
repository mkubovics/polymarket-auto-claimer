# Polymarket Auto-Claimer

A minimal, straightforward tool to automatically claim your Polymarket winnings. No complex setup, just works like the Polymarket UI but automated.

## What It Does

This tool does exactly what you do manually in Polymarket:
1. Checks for resolved markets where you won
2. Claims your USDC winnings to your Gnosis Safe
3. That's it!

## Quick Start (5 minutes)

### 1. Install Node.js
Download from [nodejs.org](https://nodejs.org/) (version 18 or higher)

### 2. Clone and Install
```bash
git clone https://github.com/toddatterbury/polymarket-auto-claimer.git
cd polymarket-auto-claimer
npm install --production
```

### 3. Configure
Copy `.env.simple` to `.env` and add your details:
```env
PRIVATE_KEY=your_metamask_private_key
PROXY_ADDRESS=your_gnosis_safe_address  
RPC_URL=https://polygon-rpc.com
```

**Where to find these:**
- `PRIVATE_KEY`: MetaMask → Account Details → Export Private Key
- `PROXY_ADDRESS`: Polymarket → Profile → Wallet Settings → Safe Address
- `RPC_URL`: Use the default or get free from [Alchemy](https://alchemy.com)

### 4. Run
```bash
npm run claim
```

That's it! The script will claim all your winnings.

## Deployment Options

### Option 1: Run Manually
```bash
npm run claim
```

### Option 2: Schedule with Cron (Linux/Mac)
```bash
# Run every hour
crontab -e
0 * * * * cd /path/to/polymarket-auto-claimer && npm run claim
```

### Option 3: Docker
```bash
docker build -f Dockerfile.simple -t polymarket-claimer .
docker run --env-file .env polymarket-claimer
```

### Option 4: Supabase Edge Function (Serverless)
```bash
# Install Supabase CLI
npm install -g supabase

# Deploy function
supabase functions deploy auto-claim

# Set environment variables in Supabase dashboard
# Schedule with pg_cron
```

## Testing on Mumbai Testnet

Before using real funds, test on Mumbai:

1. Add `TEST_MODE=true` to your `.env`
2. Get test MATIC from [Mumbai Faucet](https://mumbaifaucet.com/)
3. Run `npm run test`

See [docs/TESTNET.md](docs/TESTNET.md) for detailed testnet guide.

## How It Works

The tool mimics exactly what happens when you click "Claim" in Polymarket:

1. **Fetches positions** from Polymarket API
2. **Builds transaction** to redeem winning positions
3. **Signs with your key** (like MetaMask does)
4. **Sends to Gnosis Safe** which executes the claim
5. **USDC arrives** in your Safe wallet

## Security

- Your private key never leaves your machine
- Same security as using MetaMask
- Open source - review the code yourself
- Test on testnet first

## Common Issues

**"No positions to claim"**
- You don't have any resolved winning positions
- Markets need to be resolved first

**"Signer is not owner of Safe"**
- Wrong private key or proxy address
- Check your Polymarket wallet settings

**Transaction fails**
- Network congestion - try again later
- RPC issues - try a different RPC URL

## Costs

- **Gas**: FREE - Polymarket covers gas via their relayer
- **Fees**: None - this tool is free to use

## FAQ

**Q: Is this safe?**
A: As safe as using MetaMask. Your private key stays on your machine.

**Q: How often should I run it?**
A: Once per day is usually enough. Markets don't resolve that frequently.

**Q: Can I use this with multiple accounts?**
A: Yes, just use different `.env` files or environment variables.

**Q: Does this work with all markets?**
A: Yes, any resolved market where you hold winning positions.

## Minimal Code

The entire claimer is just ~200 lines of TypeScript in `src/simple-claimer.ts`. You can read and understand it in 10 minutes.

## Support

- Open an issue on GitHub
- Test on Mumbai testnet first
- Double-check your configuration

## License

MIT - Use at your own risk

---

**Not affiliated with Polymarket. Use at your own risk.**