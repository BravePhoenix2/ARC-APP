// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Sequential, exclusive one-hour allowlist windows followed by public minting.
abstract contract ArticMintPhases is Ownable {
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
    bool public mintClosed;
    uint256 public maxSupply;
    uint256 public totalMinted;
    uint256 public guaranteedAllocation;
    uint256 public guaranteedMinted;
    mapping(uint8 => mapping(address => uint256)) public phaseMinted;
    event AllowlistRootUpdated(bytes32 indexed previousRoot, bytes32 indexed root, uint256 guaranteedAllocation);
    event MaxSupplyReduced(uint256 previousSupply, uint256 maxSupply);
    event MintingClosed();
    error InvalidPhases();
    error PhaseNotOpen();
    error NotAllowlisted();
    error PhaseLimitExceeded();
    error AllowlistAlreadyStarted();
    error InvalidSupplyReduction();
    error MintingIsClosed();

    function _configurePhases(PhaseConfig memory config, uint256 walletCap, uint256 start, uint256 publicPrice, uint256 allocation) internal {
        if (phasesEnabled || config.root == bytes32(0) || config.collectionKey == bytes32(0)
            || config.ultimateStart != start || config.ultimateStart <= block.timestamp
            || uint256(config.fcfsStart) != uint256(config.ultimateStart) + 1 hours
            || uint256(config.publicStart) != uint256(config.fcfsStart) + 1 hours
            || config.ultimateLimit == 0 || config.fcfsLimit == 0 || config.publicLimit == 0
            || config.ultimateLimit > walletCap || config.fcfsLimit > walletCap || config.publicLimit > walletCap
            || config.ultimatePrice > publicPrice || config.fcfsPrice < config.ultimatePrice
            || allocation > maxSupply) revert InvalidPhases();
        mintPhases = config;
        guaranteedAllocation = allocation;
        phasesEnabled = true;
    }

    function supportsMintManagement() external pure returns (bool) { return true; }

    function _mintOpeningTime() internal view virtual returns (uint256);

    /// @notice Wallet lists may be edited after creation, until Guaranteed begins.
    function updateAllowlistRoot(bytes32 root, uint256 allocation) external onlyOwner {
        if (!phasesEnabled || root == bytes32(0) || allocation > maxSupply
            || allocation % mintPhases.ultimateLimit != 0) revert InvalidPhases();
        if (block.timestamp >= mintPhases.ultimateStart) revert AllowlistAlreadyStarted();
        if (mintClosed) revert MintingIsClosed();
        bytes32 previous = mintPhases.root;
        mintPhases.root = root;
        guaranteedAllocation = allocation;
        emit AllowlistRootUpdated(previous, root, allocation);
    }

    /// @notice A reduction removes only unminted supply and cannot be undone.
    function reduceMaxSupply(uint256 supply) external onlyOwner {
        if (supply == 0 || supply >= maxSupply || supply < totalMinted) revert InvalidSupplyReduction();
        if (phasesEnabled && block.timestamp < mintPhases.fcfsStart
            && supply < totalMinted + guaranteedAllocation - guaranteedMinted) revert InvalidSupplyReduction();
        uint256 previous = maxSupply;
        maxSupply = supply;
        emit MaxSupplyReduced(previous, supply);
    }

    /// @notice Public minting has no time limit; the owner can permanently close it.
    function closeMinting() external onlyOwner {
        if (mintClosed) revert MintingIsClosed();
        if (block.timestamp < _mintOpeningTime() || (phasesEnabled && currentMintPhase() != 3)) revert PhaseNotOpen();
        mintClosed = true;
        emit MintingClosed();
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
        if (tier != phase) revert NotAllowlisted();
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(mintPhases.collectionKey, msg.sender, tier))));
        if (!MerkleProof.verifyCalldata(proof, mintPhases.root, leaf)) revert NotAllowlisted();
        _consume(phase, quantity, phase == 1 ? mintPhases.ultimateLimit : mintPhases.fcfsLimit);
        if (phase == 1) {
            if (guaranteedMinted + quantity > guaranteedAllocation) revert PhaseLimitExceeded();
            guaranteedMinted += quantity;
        }
        return phase == 1 ? mintPhases.ultimatePrice : mintPhases.fcfsPrice;
    }
    function _consume(uint8 phase, uint256 quantity, uint256 limit) private {
        if (phaseMinted[phase][msg.sender] + quantity > limit) revert PhaseLimitExceeded();
        phaseMinted[phase][msg.sender] += quantity;
    }
}
