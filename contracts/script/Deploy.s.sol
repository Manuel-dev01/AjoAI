// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { Script, console2 } from "forge-std/Script.sol";
import { CircleFactory } from "../src/CircleFactory.sol";
import { ReputationLedger } from "../src/adapters/ReputationLedger.sol";
import { SimulatedYieldAdapter } from "../src/adapters/SimulatedYieldAdapter.sol";

/// @notice Deploys the AjoAI core: ReputationLedger + SimulatedYieldAdapter + CircleFactory.
///         Writes the deployed addresses to ../config/deployments.<chain>.json.
///
/// Usage (Sepolia):
///   forge script script/Deploy.s.sol \
///     --rpc-url celo_sepolia --broadcast --private-key $AGENT_PRIVATE_KEY
///
/// Env (optional):
///   CHAIN          sepolia|mainnet   (default sepolia — only labels the output file)
///   AGENT_ADDRESS  trigger key baked into circles (default: the deployer)
///   SELF_VERIFIER  Self verifier adapter (default: 0x0 == OPEN dev mode, loud)
///   YIELD_BPS      simulated yield bps (default 0 == clean principal round-trip)
contract Deploy is Script {
    function run() external {
        string memory chain = vm.envOr("CHAIN", string("sepolia"));
        address agentAddr = vm.envOr("AGENT_ADDRESS", address(0));
        address selfVerifier = vm.envOr("SELF_VERIFIER", address(0));
        uint256 yieldBps = vm.envOr("YIELD_BPS", uint256(0));
        // Redeploy (bug-fix Circle logic ⇒ new factory) can REUSE the existing ledger + yield adapter
        // so on-chain reputation history + the ERC-8004 agentId writer identity are preserved. The
        // deployer must be the ledger owner (it is — same key deployed it). Empty ⇒ deploy fresh.
        address reuseRep = vm.envOr("REUSE_REPUTATION", address(0));
        address reuseYield = vm.envOr("REUSE_YIELD", address(0));

        vm.startBroadcast();
        address deployer = msg.sender;
        if (agentAddr == address(0)) agentAddr = deployer;

        address repAddr = reuseRep != address(0) ? reuseRep : address(new ReputationLedger());
        address yieldAddr =
            reuseYield != address(0) ? reuseYield : address(new SimulatedYieldAdapter(uint16(yieldBps)));
        CircleFactory factory = new CircleFactory(agentAddr, selfVerifier, repAddr, yieldAddr);

        // Authorize the NEW factory to register each circle it spawns as a reputation writer.
        // On a reused ledger this only ADDS the new factory (old circles keep their writer rights).
        ReputationLedger(repAddr).setRegistrar(address(factory), true);

        vm.stopBroadcast();

        console2.log("chain:           ", chain);
        console2.log("deployer:        ", deployer);
        console2.log("agent:           ", agentAddr);
        console2.log("selfVerifier:    ", selfVerifier);
        console2.log("ReputationLedger:", repAddr, reuseRep != address(0) ? "(reused)" : "(new)");
        console2.log("YieldAdapter:    ", yieldAddr, reuseYield != address(0) ? "(reused)" : "(new)");
        console2.log("CircleFactory:   ", address(factory));

        _writeDeployments(chain, address(factory), repAddr, yieldAddr, agentAddr);
    }

    function _writeDeployments(
        string memory chain,
        address factory,
        address rep,
        address yield_,
        address agentAddr
    ) internal {
        string memory obj = "deployments";
        vm.serializeAddress(obj, "circleFactory", factory);
        vm.serializeAddress(obj, "reputationLedger", rep);
        vm.serializeAddress(obj, "yieldAdapter", yield_);
        vm.serializeAddress(obj, "agent", agentAddr);
        string memory json = vm.serializeUint(obj, "deployedAtBlock", block.number);

        string memory path = string.concat("../config/deployments.", chain, ".json");
        vm.writeJson(json, path);
        console2.log("wrote:", path);
    }
}
