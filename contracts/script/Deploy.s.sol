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

        vm.startBroadcast();
        address deployer = msg.sender;
        if (agentAddr == address(0)) agentAddr = deployer;

        ReputationLedger rep = new ReputationLedger();
        SimulatedYieldAdapter yield_ = new SimulatedYieldAdapter(uint16(yieldBps));
        CircleFactory factory =
            new CircleFactory(agentAddr, selfVerifier, address(rep), address(yield_));

        // Let the factory auto-authorize each new circle as a reputation writer.
        rep.setRegistrar(address(factory), true);

        vm.stopBroadcast();

        console2.log("chain:           ", chain);
        console2.log("deployer:        ", deployer);
        console2.log("agent:           ", agentAddr);
        console2.log("selfVerifier:    ", selfVerifier);
        console2.log("ReputationLedger:", address(rep));
        console2.log("YieldAdapter:    ", address(yield_));
        console2.log("CircleFactory:   ", address(factory));

        _writeDeployments(chain, address(factory), address(rep), address(yield_), agentAddr);
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
