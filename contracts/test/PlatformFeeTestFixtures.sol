// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

interface IPlatformFeeWithdrawal {
    function withdrawPlatformFees(address payable receiver) external;
}

/// @dev Test fixtures for rejecting treasury wallets and untrusted royalty hooks.
contract PlatformFeeTestReceiver {
    address private immutable controller = msg.sender;
    receive() external payable { revert("Reject native payments"); }
    function withdrawFees(address target, address payable receiver) external {
        require(msg.sender == controller, "Controller only");
        IPlatformFeeWithdrawal(target).withdrawPlatformFees(receiver);
    }
}

contract PlatformFeeTestNFT is ERC721 {
    address private immutable royaltyReceiver;
    bool private immutable rejectsRoyalty;
    constructor(address receiver_, bool rejectsRoyalty_) ERC721("Fee test", "FEET") {
        royaltyReceiver = receiver_;
        rejectsRoyalty = rejectsRoyalty_;
        _mint(msg.sender, 1);
    }
    function royaltyInfo(uint256, uint256 salePrice) external view returns (address, uint256) {
        require(!rejectsRoyalty, "Royalty hook rejected");
        return (royaltyReceiver, salePrice * 2);
    }
}
