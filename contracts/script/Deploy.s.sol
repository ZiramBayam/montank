// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {AegisVault} from "../src/AegisVault.sol";

/// @title Deploy AegisVault (see README.md for setup and usage).
/// @notice Semua parameter lewat env (fail-fast bila wajib tidak terisi):
///         WAJIB  : DEPLOYER_PRIVATE_KEY, GUARDIAN_1..3, WORKER_1, WORKER_2,
///                  GUARDIAN_MASK (7), EXPIRY_BLOCKS, WINDOW_BLOCKS,
///                  VAULT_FUNDING (wei, boleh 0 untuk demo tanpa dana)
///         OPSION : VENDOR_ADDR + VENDOR_PER_TX_CAP / VENDOR_PER_WINDOW_CAP (wei)
///       Deploy demo memakai GUARDIAN_MASK=7 (0b111) agar semua tiga guardian aktif.
contract Deploy is Script {
    function run() external returns (AegisVault vault) {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");

        address[3] memory guardians = [
            vm.envAddress("GUARDIAN_1"),
            vm.envAddress("GUARDIAN_2"),
            vm.envAddress("GUARDIAN_3")
        ];
        address[] memory workers = new address[](2);
        workers[0] = vm.envAddress("WORKER_1");
        workers[1] = vm.envAddress("WORKER_2");

        uint256 guardianMaskInput = vm.envUint("GUARDIAN_MASK");
        require(guardianMaskInput == 0x7, "THREE_GUARDIANS_REQUIRED");
        uint8 guardianMask = uint8(guardianMaskInput);
        uint64 expiryBlocks = uint64(vm.envUint("EXPIRY_BLOCKS"));
        uint64 windowBlocks = uint64(vm.envUint("WINDOW_BLOCKS"));
        uint256 funding = vm.envUint("VAULT_FUNDING");

        vm.startBroadcast(pk);

        // New-recipient payouts are bound to one-time, evidence-backed claims.
        vault = new AegisVault{value: funding}(guardians, workers, guardianMask, expiryBlocks, windowBlocks, true);

        // Payee vendor opsional (Jalur A - cair instan dengan pelindung Layer 0)
        address vendorAddr = vm.envOr("VENDOR_ADDR", address(0));
        if (vendorAddr != address(0)) {
            uint96 perTx = uint96(vm.envOr("VENDOR_PER_TX_CAP", uint256(1 ether)));
            uint96 perWin = uint96(vm.envOr("VENDOR_PER_WINDOW_CAP", uint256(2 ether)));
            vault.registerPayee(vendorAddr, perTx, perWin);
            console2.log("VENDOR_REGISTERED:", vendorAddr);
            console2.log("VENDOR_PER_TX_CAP (wei):", uint256(perTx));
            console2.log("VENDOR_PER_WINDOW_CAP (wei):", uint256(perWin));
        }

        console2.log("VAULT_ADDRESS:", address(vault));
        console2.log("OWNER (deployer):", vm.addr(pk));
        console2.log("GUARDIAN_MASK:", uint256(guardianMask));
        console2.log("EXPIRY_BLOCKS:", uint256(expiryBlocks));
        console2.log("WINDOW_BLOCKS:", uint256(windowBlocks));
        console2.log("VAULT_FUNDING (wei):", funding);

        vm.stopBroadcast();
    }
}
