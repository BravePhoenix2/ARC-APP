// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {ArticStudioCollection} from "./ArticStudioCollection.sol";
import {ArticEdition} from "./ArticEdition.sol";
contract ArticCollectionDeployer {
    address private immutable factory = msg.sender;
    function deploy(string calldata name_, string calldata symbol_, string calldata metadataURI_, uint256 mintPrice_, uint256 mintStartTime_, uint256 maxSupply_, uint256 maxPerWallet_, uint96 royaltyBps_, bool soulbound_, address creator_, address registry_) external returns (address) {
        require(msg.sender == factory, "Factory only");
        return address(new ArticStudioCollection(name_, symbol_, metadataURI_, mintPrice_, mintStartTime_, maxSupply_, maxPerWallet_, royaltyBps_, soulbound_, creator_, registry_));
    }
}
contract ArticEditionDeployer {
    address private immutable factory = msg.sender;
    function deploy(string calldata name_, string calldata symbol_, string calldata metadataURI_, uint256 mintPrice_, uint256 mintStartTime_, uint256 maxSupply_, uint256 maxPerWallet_, uint96 royaltyBps_, address creator_, address registry_) external returns (address) {
        require(msg.sender == factory, "Factory only");
        return address(new ArticEdition(name_, symbol_, metadataURI_, mintPrice_, mintStartTime_, maxSupply_, maxPerWallet_, royaltyBps_, creator_, registry_));
    }
}
