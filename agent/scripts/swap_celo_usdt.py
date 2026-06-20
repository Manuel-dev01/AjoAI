"""Restore the agent's USD₮ working float: swap CELO -> exactly TARGET_USDT via Uniswap V3
SwapRouter02 on Celo (exactOutputSingle, so excess CELO is not spent). Key from env AGENT_KEY,
never printed. On Celo, CELO is an ERC20 (0x471E…) so the router pulls it via transferFrom -> approve."""
import os, time
from web3 import Web3

RPC = "https://forno.celo.org"
USDT = Web3.to_checksum_address("0x48065fBBE25f71C9282ddf5e1cD6D6A887483D5e")
CELO = Web3.to_checksum_address("0x471EcE3750Da237f93B8E339c536989b8978a438")
ROUTER = Web3.to_checksum_address("0x5615CDAb10dc425a742d643d949a7F474C01abc4")  # SwapRouter02
QUOTER = Web3.to_checksum_address("0x82825d0554fA07f7FC52Ab63c961F330fdEFa8E8")
FEE = 100
TARGET_USDT = 5_000_000  # 5.0 USD₮ (6 dec)
MAX_SLIPPAGE_BPS = 300    # allow up to 3% more CELO in than quoted

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
quoter_abi = [{"inputs":[{"components":[{"name":"tokenIn","type":"address"},{"name":"tokenOut","type":"address"},{"name":"amount","type":"uint256"},{"name":"fee","type":"uint24"},{"name":"sqrtPriceLimitX96","type":"uint160"}],"name":"params","type":"tuple"}],"name":"quoteExactOutputSingle","outputs":[{"name":"amountIn","type":"uint256"},{"name":"","type":"uint160"},{"name":"","type":"uint32"},{"name":"","type":"uint256"}],"stateMutability":"nonpayable","type":"function"}]
router_abi = [{"inputs":[{"components":[{"name":"tokenIn","type":"address"},{"name":"tokenOut","type":"address"},{"name":"fee","type":"uint24"},{"name":"recipient","type":"address"},{"name":"amountOut","type":"uint256"},{"name":"amountInMaximum","type":"uint256"},{"name":"sqrtPriceLimitX96","type":"uint160"}],"name":"params","type":"tuple"}],"name":"exactOutputSingle","outputs":[{"name":"amountIn","type":"uint256"}],"stateMutability":"payable","type":"function"}]

celo = w3.eth.contract(address=CELO, abi=erc20_abi)
usdt = w3.eth.contract(address=USDT, abi=erc20_abi)
router = w3.eth.contract(address=ROUTER, abi=router_abi)
quoter = w3.eth.contract(address=QUOTER, abi=quoter_abi)

celo_before = w3.eth.get_balance(me)
usdt_before = usdt.functions.balanceOf(me).call()
print(f"signer {me}")
print(f"CELO before: {celo_before/1e18:.4f}  USDT before: {usdt_before/1e6}  target out: {TARGET_USDT/1e6} USDT")

quoted_in = quoter.functions.quoteExactOutputSingle((CELO, USDT, TARGET_USDT, FEE, 0)).call()[0]
amount_in_max = quoted_in * (10_000 + MAX_SLIPPAGE_BPS) // 10_000
print(f"quote: ~{quoted_in/1e18:.4f} CELO in for {TARGET_USDT/1e6} USDT  (max {amount_in_max/1e18:.4f} CELO)")
assert amount_in_max < celo_before - w3.to_wei(2, "ether"), "would leave too little CELO for gas"

def send(fn, gas):
    gp = int(w3.eth.gas_price * 1.3)
    tx = fn.build_transaction({"from": me, "nonce": w3.eth.get_transaction_count(me, "pending"),
                               "chainId": chain_id, "gas": gas, "value": 0, "gasPrice": gp})
    signed = acct.sign_transaction(tx)
    h = w3.eth.send_raw_transaction(signed.raw_transaction)
    r = w3.eth.wait_for_transaction_receipt(h, timeout=180)
    return h.hex(), r["status"]

if celo.functions.allowance(me, ROUTER).call() < amount_in_max:
    h, st = send(celo.functions.approve(ROUTER, amount_in_max), gas=120_000)
    print(f"approve tx {h} status={st}"); assert st == 1
    time.sleep(3)

params = (CELO, USDT, FEE, me, TARGET_USDT, amount_in_max, 0)
h, st = send(router.functions.exactOutputSingle(params), gas=400_000)
print(f"swap tx {h} status={st}"); assert st == 1
time.sleep(4)
print(f"DONE. CELO after: {w3.eth.get_balance(me)/1e18:.4f}  USDT after: {usdt.functions.balanceOf(me).call()/1e6}")
