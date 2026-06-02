// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title ICircleFactory — deploys and indexes Circle instances.
interface ICircleFactory {
    function createCircle(
        address token,
        uint256 contribution,
        uint256 period,
        uint256 graceWindow,
        uint16 penaltyBps,
        uint8 slots
    ) external returns (address circle);

    event CircleCreated(address indexed circle, address indexed organizer);
}
