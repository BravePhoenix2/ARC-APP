// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Immutable platform terms and a pull-payment treasury ledger.
/// Seller balances, bid refunds and reward pools are accounted for separately.
abstract contract ArticPlatformFees is ReentrancyGuard {
    uint256 public constant MAX_PLATFORM_FEE_BPS = 1_000;
    uint256 internal constant BPS_DENOMINATOR = 10_000;
    address public immutable feeRecipient;
    uint256 public immutable platformFeeBps;
    uint256 public pendingPlatformFees;
    uint256 public totalPlatformFees;

    event PlatformFeeAccrued(address indexed source, uint256 amount);
    event PlatformFeesWithdrawn(address indexed recipient, address indexed receiver, uint256 amount);

    error InvalidFeeRecipient();
    error PlatformFeeTooHigh();
    error NotFeeRecipient();
    error NoPlatformFees();
    error PlatformFeePayoutFailed();

    constructor(address feeRecipient_, uint256 platformFeeBps_) {
        if (feeRecipient_ == address(0)) revert InvalidFeeRecipient();
        if (platformFeeBps_ > MAX_PLATFORM_FEE_BPS) revert PlatformFeeTooHigh();
        feeRecipient = feeRecipient_;
        platformFeeBps = platformFeeBps_;
    }

    function _platformFee(uint256 grossAmount) internal view returns (uint256) {
        return (grossAmount * platformFeeBps) / BPS_DENOMINATOR;
    }

    function _accruePlatformFee(uint256 amount) internal {
        if (amount == 0) return;
        pendingPlatformFees += amount;
        totalPlatformFees += amount;
        emit PlatformFeeAccrued(msg.sender, amount);
    }

    /// @notice Only the treasury can claim its fees, to a receiver it chooses.
    function withdrawPlatformFees(address payable receiver) external nonReentrant {
        if (msg.sender != feeRecipient) revert NotFeeRecipient();
        if (receiver == address(0)) revert InvalidFeeRecipient();
        uint256 amount = pendingPlatformFees;
        if (amount == 0) revert NoPlatformFees();
        pendingPlatformFees = 0;
        (bool sent,) = receiver.call{value: amount}("");
        if (!sent) revert PlatformFeePayoutFailed();
        emit PlatformFeesWithdrawn(msg.sender, receiver, amount);
    }
}
