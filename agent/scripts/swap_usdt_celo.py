"""One-shot: swap the agent's full USDT balance -> CELO via Uniswap V3 SwapRouter02 on Celo.
Key is read from env AGENT_KEY (never printed). Approve -> exactInputSingle (0.01% pool, deepest).
Gas paid in native CELO (no CIP-64 feeCurrency field, which eth-account can't sign)."""
import os, sys, time
from web3 import Web3

RPC = "https://forno.celo.org"
USDT = Web3.to_checksum_address("0x48065fBBE25f71C9282ddf5e1cD6D6A887483D5e")
CELO = Web3.to_checksum_address("0x471EcE3750Da237f93B8E339c536989b8978a438")
ROUTER = Web3.to_checksum_address("0x5615CDAb10dc425a742d643d949a7F474C01abc4")  # SwapRouter02
FEE = 100  # 0.01% — deepest USDT/CELO pool, best output
SLIPPAGE_BPS = 200  # 2%

key = os.environ["AGENT_KEY"].strip()
if not key.startswith("0x"):
    key = "0x" + key

w3 = Web3(Web3.HTTPProvider(RPC))
acct = w3.eth.account.from_key(key)
me = acct.address
assert me.lower() == "0x8974881E39a5eF62214929B6CaA6EC0C6e7D47c7".lower(), f"unexpected signer {me}"
chain_id = w3.eth.chain_id

erc20_abi = [
    {"inputs":[{"type":"address"}],"name":"balanceOf","outputs":[{"type":"uint256"}],"stateMutability":"view","type":"function"},
    {"inputs":[{"type":"address"},{"type":"address"}],"name":"allowance","outputs":[{"type":"uint256"}],"stateMutability":"view","type":"function"},
    {"inputs":[{"type":"address"},{"type":"uint256"}],"name":"approve","outputs":[{"type":"bool"}],"stateMutability":"nonpayable","type":"function"},
]
quoter_abi = [{"inputs":[{"components":[{"name":"tokenIn","type":"address"},{"name":"tokenOut","type":"address"},{"name":"amountIn","type":"uint256"},{"name":"fee","type":"uint24"},{"name":"sqrtPriceLimitX96","type":"uint160"}],"name":"params","type":"tuple"}],"name":"quoteExactInputSingle","outputs":[{"name":"amountOut","type":"uint256"},{"name":"","type":"uint160"},{"name":"","type":"uint32"},{"name":"","type":"uint256"}],"stateMutability":"nonpayable","type":"function"}]
# SwapRouter02 ExactInputSingleParams has NO deadline (removed vs SwapRouter v1).
router_abi = [{"inputs":[{"components":[{"name":"tokenIn","type":"address"},{"name":"tokenOut","type":"address"},{"name":"fee","type":"uint24"},{"name":"recipient","type":"address"},{"name":"amountIn","type":"uint256"},{"name":"amountOutMinimum","type":"uint256"},{"name":"sqrtPriceLimitX96","type":"uint160"}],"name":"params","type":"tuple"}],"name":"exactInputSingle","outputs":[{"name":"amountOut","type":"uint256"}],"stateMutability":"payable","type":"function"}]

usdt = w3.eth.contract(address=USDT, abi=erc20_abi)
router = w3.eth.contract(address=ROUTER, abi=router_abi)
quoter = w3.eth.contract(address=Web3.to_checksum_address("0x82825d0554fA07f7FC52Ab63c961F330fdEFa8E8"), abi=quoter_abi)

amount_in = usdt.functions.balanceOf(me).call()
celo_before = w3.eth.get_balance(me)
print(f"signer {me}")
print(f"USDT in: {amount_in/1e6}  CELO before: {celo_before/1e18:.4f}")
assert amount_in > 0, "no USDT to swap"

quoted = quoter.functions.quoteExactInputSingle((USDT, CELO, amount_in, FEE, 0)).call()[0]
amount_out_min = quoted * (10_000 - SLIPPAGE_BPS) // 10_000
print(f"quote: {quoted/1e18:.4f} CELO  -> amountOutMin(2%): {amount_out_min/1e18:.4f} CELO")

def send(fn, gas):
    gp = int(w3.eth.gas_price * 1.3)  # Celo base fee runs ~200-300 gwei; use live price + buffer
    tx = fn.build_transaction({
        "from": me, "nonce": w3.eth.get_transaction_count(me, "pending"),
        "chainId": chain_id, "gas": gas, "value": 0, "gasPrice": gp,
    })
    signed = acct.sign_transaction(tx)
    h = w3.eth.send_raw_transaction(signed.raw_transaction)
    r = w3.eth.wait_for_transaction_receipt(h, timeout=180)
    return h.hex(), r["status"]

# 1) approve exact amount (allowance is 0 fresh)
allow = usdt.functions.allowance(me, ROUTER).call()
if allow < amount_in:
    h, st = send(usdt.functions.approve(ROUTER, amount_in), gas=120_000)
    print(f"approve tx {h} status={st}")
    assert st == 1, "approve failed"
    time.sleep(3)

# 2) swap
params = (USDT, CELO, FEE, me, amount_in, amount_out_min, 0)
h, st = send(router.functions.exactInputSingle(params), gas=400_000)
print(f"swap tx {h} status={st}")
assert st == 1, "swap failed"

time.sleep(4)
celo_after = w3.eth.get_balance(me)
usdt_after = usdt.functions.balanceOf(me).call()
print(f"DONE. CELO after: {celo_after/1e18:.4f} (+{(celo_after-celo_before)/1e18:.4f})  USDT left: {usdt_after/1e6}")
