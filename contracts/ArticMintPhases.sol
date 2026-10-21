// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/// @notice Immutable, sequential allowlist windows. Global supply/wallet caps still apply.
abstract contract ArticMintPhases {
    struct PhaseConfig {
        bytes32 root;
        bytes32 collectionKey;
        uint64 ultimateStart;
        uint64 fcfsStart;
        uint64 publicStart;
        uint32 ultimateLimit;
        uint32 fcfsLimit;
        uint32 publicLimit;
        uint256 ultimatePrice;
        uint256 fcfsPrice;
    }
    PhaseConfig public mintPhases;
    bool public phasesEnabled;
    mapping(uint8 => mapping(address => uint256)) public phaseMinted;
    error InvalidPhases();
    error PhaseNotOpen();
    error NotAllowlisted();
    error PhaseLimitExceeded();

    function _configurePhases(PhaseConfig memory config, uint256 walletCap, uint256 start, uint256 publicPrice) internal {
        if (phasesEnabled || config.root == bytes32(0) || config.collectionKey == bytes32(0)
            || config.ultimateStart != start || config.ultimateStart >= config.fcfsStart || config.fcfsStart >= config.publicStart
            || config.ultimateLimit == 0 || config.fcfsLimit == 0 || config.publicLimit == 0
            || config.ultimateLimit > walletCap || config.fcfsLimit > walletCap || config.publicLimit > walletCap
            || config.ultimatePrice > publicPrice || config.fcfsPrice > publicPrice) revert InvalidPhases();
        mintPhases = config;
        phasesEnabled = true;
    }
    function currentMintPhase() public view returns (uint8) {
        if (!phasesEnabled || block.timestamp >= mintPhases.publicStart) return 3;
        if (block.timestamp >= mintPhases.fcfsStart) return 2;
        if (block.timestamp >= mintPhases.ultimateStart) return 1;
        return 0;
    }
    function _checkPublicPhase(uint256 quantity) internal {
        if (!phasesEnabled) return;
        if (currentMintPhase() != 3) revert PhaseNotOpen();
        _consume(3, quantity, mintPhases.publicLimit);
    }
    function _checkAllowlistPhase(uint256 quantity, uint8 tier, bytes32[] calldata proof) internal returns (uint256) {
        uint8 phase = currentMintPhase();
        if (!phasesEnabled || (phase != 1 && phase != 2)) revert PhaseNotOpen();
        if ((tier != 1 && tier != 2) || (phase == 1 && tier != 1)) revert NotAllowlisted();
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(mintPhases.collectionKey, msg.sender, tier))));
        if (!MerkleProof.verifyCalldata(proof, mintPhases.root, leaf)) revert NotAllowlisted();
        _consume(phase, quantity, phase == 1 ? mintPhases.ultimateLimit : mintPhases.fcfsLimit);
        return phase == 1 ? mintPhases.ultimatePrice : mintPhases.fcfsPrice;
    }
    function _consume(uint8 phase, uint256 quantity, uint256 limit) private {
        if (phaseMinted[phase][msg.sender] + quantity > limit) revert PhaseLimitExceeded();
        phaseMinted[phase][msg.sender] += quantity;
    }
}
