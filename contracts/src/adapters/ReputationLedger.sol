// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { IReputation } from "../interfaces/IReputation.sol";

/// @title ReputationLedger — on-chain savings-credit score (CLAUDE.md §4 mapping).
/// @notice Implements IReputation; circles call write() on contribution outcomes. Maintains a
///         cumulative signed score + counters per member, the portable "savings-credit" primitive
///         future micro-credit can underwrite against. Phase 3 bridges these signals to the real
///         ERC-8004 Reputation Registry (off-chain via chaoschain-sdk / on-chain via a forwarder).
/// @dev Only authorized circles (registered by the factory/owner) may write. Never reverts the
///      caller's money path: writes are cheap and access-gated, not value-moving.
contract ReputationLedger is IReputation {
    address public owner;
    mapping(address => bool) public isWriter; // authorized circles
    mapping(address => bool) public isRegistrar; // factories allowed to authorize writers

    struct Score {
        int256 score; // cumulative signed reputation
        uint64 onTime;
        uint64 late;
        uint64 defaults;
        uint64 completions;
    }

    mapping(address => Score) public scoreOf;

    event WriterSet(address indexed writer, bool allowed);
    event RegistrarSet(address indexed registrar, bool allowed);
    event Signal(address indexed member, int256 delta, int256 newScore, string reason);

    error NotOwner();
    error NotWriter();
    error NotRegistrar();

    constructor() {
        owner = msg.sender;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    function setOwner(address o) external onlyOwner {
        owner = o;
    }

    function setWriter(address writer, bool allowed) external onlyOwner {
        isWriter[writer] = allowed;
        emit WriterSet(writer, allowed);
    }

    function setRegistrar(address registrar, bool allowed) external onlyOwner {
        isRegistrar[registrar] = allowed;
        emit RegistrarSet(registrar, allowed);
    }

    /// @notice A registered factory authorizes a freshly-created circle as a writer.
    function authorizeWriter(address writer) external {
        if (!isRegistrar[msg.sender]) revert NotRegistrar();
        isWriter[writer] = true;
        emit WriterSet(writer, true);
    }

    function write(address member, int256 delta, string calldata reason) external {
        if (!isWriter[msg.sender]) revert NotWriter();
        Score storage s = scoreOf[member];
        s.score += delta;

        bytes32 r = keccak256(bytes(reason));
        if (r == keccak256("on_time")) s.onTime++;
        else if (r == keccak256("late")) s.late++;
        else if (r == keccak256("default")) s.defaults++;
        else if (r == keccak256("completed")) s.completions++;

        emit Signal(member, delta, s.score, reason);
    }

    function getScore(address member) external view returns (int256) {
        return scoreOf[member].score;
    }
}
