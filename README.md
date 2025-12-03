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
You can keep the secrets file outside the repository (recommended). The loader searches in this order (first hit wins unless you explicitly pass `--env-file`):
1. `--env-file <path>` or `--env-file=path`
2. `ENV_PATH` environment variable
3. Parent directory: `../.env`
4. Repository root: `./.env`

Example `.env` (wherever you place it):
```env
PK=your_metamask_private_key
POLYMARKET_PROXY_ADDRESS=your_gnosis_safe_address  
RPC_URL=https://polygon-rpc.com
# Optional:
# LOOP_INTERVAL_MINUTES=60
# TEST_MODE=true
```

**Where to find these:**
- `PK`: MetaMask → Account Details → Export Private Key (use a low-privileged key / owner)
- `POLYMARKET_PROXY_ADDRESS`: Polymarket → Profile → Wallet Settings → Safe Address
- `RPC_URL`: Use the default or get free from [Alchemy](https://alchemy.com)

> Migration Note: Environment variables were renamed for clarity.
> Old names `PRIVATE_KEY` and `PROXY_ADDRESS` have been replaced with `PK` and `POLYMARKET_PROXY_ADDRESS`.
> Update your `.env` accordingly. If you still have the old keys set, the script will now error with a missing variable message until you rename them.

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

### Option 1b: Manual Loop Mode (built-in)
Run continuously every 60 minutes (default):
```bash
node dist/simple-claimer.js --loop
```
Customize interval (e.g. every 30 minutes):
```bash
node dist/simple-claimer.js --loop --interval 30
```
Or (equals syntax):
```bash
node dist/simple-claimer.js --loop --interval=15
```
Dry-run plus loop:
```bash
node dist/simple-claimer.js --loop --interval 120 --dry-run
```

Environment variable alternative (implies loop if set):
```bash
export LOOP_INTERVAL_MINUTES=45
node dist/simple-claimer.js
```

Graceful shutdown: press Ctrl+C once; it finishes the current iteration and exits.

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

If your `.env` lives outside the repo (one level up):
```bash
docker run --env-file ../.env polymarket-claimer
```

Or specify explicitly:
```bash
docker run -e ENV_PATH=/secrets/polymarket.env -v /secrets/polymarket.env:/secrets/polymarket.env:ro polymarket-claimer
```

To use loop mode inside Docker without external cron, override the command:
```bash
docker run --env-file .env polymarket-claimer node dist/simple-claimer.js --loop --interval 60
```

(If you are already using the provided Fly.io / cron setup, you do NOT need --loop.)

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