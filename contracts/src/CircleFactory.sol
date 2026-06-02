// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { Circle } from "./Circle.sol";
import { ICircleFactory } from "./interfaces/ICircleFactory.sol";

interface IWriterRegistrar {
    function authorizeWriter(address writer) external;
}

/// @title CircleFactory — deploys Circle instances and indexes them for discovery.
/// @notice Default integration addresses (selfVerifier/reputation/yieldAdapter) are set once
///         by the owner and reused for every circle, so the agent + UI read them from one place.
contract CircleFactory is ICircleFactory {
    address public owner;
    address public agent; // default trigger key baked into each circle
    address public selfVerifier; // address(0) => OPEN dev mode
    address public reputation; // address(0) => no-op
    address public yieldAdapter; // address(0) => no yield

    address[] public allCircles;
    mapping(address => address[]) public circlesByOrganizer;

    error NotOwner();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address _agent, address _selfVerifier, address _reputation, address _yieldAdapter) {
        owner = msg.sender;
        agent = _agent;
        selfVerifier = _selfVerifier;
        reputation = _reputation;
        yieldAdapter = _yieldAdapter;
    }

    function setOwner(address o) external onlyOwner {
        owner = o;
    }

    function setIntegrations(
        address _agent,
        address _selfVerifier,
        address _reputation,
        address _yieldAdapter
    ) external onlyOwner {
        agent = _agent;
        selfVerifier = _selfVerifier;
        reputation = _reputation;
        yieldAdapter = _yieldAdapter;
    }

    function createCircle(
        address token,
        uint256 contribution,
        uint256 period,
        uint256 graceWindow,
        uint16 penaltyBps,
        uint8 slots
    ) external returns (address circle) {
        Circle.Config memory cfg = Circle.Config({
            token: token,
            contribution: contribution,
            period: period,
            graceWindow: graceWindow,
            penaltyBps: penaltyBps,
            slots: slots,
            organizer: msg.sender,
            agent: agent,
            selfVerifier: selfVerifier,
            reputation: reputation,
            yieldAdapter: yieldAdapter
        });
        circle = address(new Circle(cfg));
        allCircles.push(circle);
        circlesByOrganizer[msg.sender].push(circle);

        // Auto-authorize the new circle to write reputation (if the ledger supports it).
        if (reputation != address(0)) {
            try IWriterRegistrar(reputation).authorizeWriter(circle) { } catch { }
        }
        emit CircleCreated(circle, msg.sender);
    }

    function allCirclesLength() external view returns (uint256) {
        return allCircles.length;
    }
}
