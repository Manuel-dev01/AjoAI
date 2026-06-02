// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { ISelfVerifier } from "../../src/interfaces/ISelfVerifier.sol";

/// @dev Test stand-in for Self. The proof bytes encode the humanId, so two different accounts
///      can present the SAME humanId to exercise the "one human, one slot" guard (CLAUDE.md §1.6).
contract MockSelfVerifier is ISelfVerifier {
    bool public rejectAll;

    error Rejected();

    function setReject(bool v) external {
        rejectAll = v;
    }

    function verify(address, bytes calldata proof) external view returns (bytes32 humanId) {
        if (rejectAll) revert Rejected();
        humanId = abi.decode(proof, (bytes32));
    }
}
