// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ArticStudioCollection} from "./ArticStudioCollection.sol";
import {ArticEdition} from "./ArticEdition.sol";

/// @notice Permissionless creator-owned collections and an authenticated mint-activity registry.
contract ArticStudioFactory {
    struct CollectionInfo {
        address collection;
        address creator;
        uint8 standard;
        bool soulbound;
        uint256 createdAt;
    }

    CollectionInfo[] private _allCollections;
    mapping(address => address[]) private _collectionsByCreator;
    mapping(address => address) public collectionCreator;
    mapping(address => bool) public hasMinted;

    event CollectionCreated(address indexed creator, address indexed collection, uint8 standard, bool soulbound, string name, string symbol);
    event MintActivityRecorded(address indexed minter, address indexed collection);
    error NotRegisteredCollection();
    error InvalidMinter();

    function create721(
        string calldata name_, string calldata symbol_, string calldata metadataURI_, uint256 mintPrice_,
        uint256 mintStartTime_, uint256 maxSupply_, uint256 maxPerWallet_, uint96 royaltyBps_, bool soulbound_
    ) external returns (address collection) {
        collection = address(new ArticStudioCollection(name_, symbol_, metadataURI_, mintPrice_, mintStartTime_, maxSupply_, maxPerWallet_, royaltyBps_, soulbound_, msg.sender, address(this)));
        _register(collection, 1, soulbound_, name_, symbol_);
    }

    function createEdition(
        string calldata name_, string calldata symbol_, string calldata metadataURI_, uint256 mintPrice_,
        uint256 mintStartTime_, uint256 maxSupply_, uint256 maxPerWallet_, uint96 royaltyBps_
    ) external returns (address collection) {
        collection = address(new ArticEdition(name_, symbol_, metadataURI_, mintPrice_, mintStartTime_, maxSupply_, maxPerWallet_, royaltyBps_, msg.sender, address(this)));
        _register(collection, 2, false, name_, symbol_);
    }

    function _register(address collection, uint8 standard, bool soulbound, string calldata name_, string calldata symbol_) private {
        collectionCreator[collection] = msg.sender;
        _collectionsByCreator[msg.sender].push(collection);
        _allCollections.push(CollectionInfo(collection, msg.sender, standard, soulbound, block.timestamp));
        emit CollectionCreated(msg.sender, collection, standard, soulbound, name_, symbol_);
    }

    function notifyMint(address minter) external {
        if (collectionCreator[msg.sender] == address(0)) revert NotRegisteredCollection();
        if (minter == address(0)) revert InvalidMinter();
        if (!hasMinted[minter]) {
            hasMinted[minter] = true;
            emit MintActivityRecorded(minter, msg.sender);
        }
    }

    function totalCollections() external view returns (uint256) { return _allCollections.length; }
    function getAllCollections() external view returns (CollectionInfo[] memory) { return _allCollections; }
    function getCollectionsByCreator(address creator) external view returns (address[] memory) { return _collectionsByCreator[creator]; }
}
