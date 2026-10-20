// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ArticNFT} from "./ArticNFT.sol";

/// @title ArticFactory
/// @notice Lets any creator deploy their own ArticNFT collection through
/// Artic, and indexes every deployment on-chain and via an event so the
/// backend can pick it up.
contract ArticFactory {
    struct CollectionInfo {
        address collection;
        address creator;
        uint256 createdAt;
    }

    CollectionInfo[] private _allCollections;
    mapping(address => address[]) private _collectionsByCreator;

    event CollectionCreated(
        address indexed creator,
        address indexed collection,
        string name,
        string symbol,
        uint256 mintPrice,
        uint256 mintStartTime,
        uint256 maxSupply,
        uint256 maxPerWallet
    );

    /// @notice Deploy a new NFT collection owned by the caller.
    /// @param name_ ERC-721 collection name.
    /// @param symbol_ ERC-721 collection symbol.
    /// @param baseURI_ Base metadata URI (per-token JSON, including rarity traits, lives here).
    /// @param mintPrice_ Mint price per token, in native USDC (18 decimals).
    /// @param mintStartTime_ Unix timestamp minting opens at.
    /// @param maxSupply_ Maximum tokens that will ever exist in the collection.
    /// @param maxPerWallet_ Maximum tokens a single wallet may mint.
    function createCollection(
        string calldata name_,
        string calldata symbol_,
        string calldata baseURI_,
        uint256 mintPrice_,
        uint256 mintStartTime_,
        uint256 maxSupply_,
        uint256 maxPerWallet_
    ) external returns (address collection) {
        ArticNFT nft = new ArticNFT(
            name_,
            symbol_,
            baseURI_,
            mintPrice_,
            mintStartTime_,
            maxSupply_,
            maxPerWallet_,
            msg.sender
        );

        collection = address(nft);

        _allCollections.push(CollectionInfo({collection: collection, creator: msg.sender, createdAt: block.timestamp}));
        _collectionsByCreator[msg.sender].push(collection);

        emit CollectionCreated(
            msg.sender,
            collection,
            name_,
            symbol_,
            mintPrice_,
            mintStartTime_,
            maxSupply_,
            maxPerWallet_
        );
    }

    function totalCollections() external view returns (uint256) {
        return _allCollections.length;
    }

    function getAllCollections() external view returns (CollectionInfo[] memory) {
        return _allCollections;
    }

    function getCollectionsByCreator(address creator) external view returns (address[] memory) {
        return _collectionsByCreator[creator];
    }
}
