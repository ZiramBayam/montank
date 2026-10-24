// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {AegisVault} from "../src/AegisVault.sol";

/// @notice Register the exact claim record used by the backend ledger.
contract RegisterClaim is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        AegisVault vault = AegisVault(payable(vm.envAddress("AEGIS_VAULT_ADDRESS")));
        string memory claimId = vm.envString("CLAIM_ID");
        string memory category = vm.envString("CLAIM_CATEGORY");
        address recipient = vm.envAddress("CLAIM_RECIPIENT");
        uint256 amountWei = vm.envUint("CLAIM_AMOUNT_WEI");
        uint256 validUntilBlockInput = vm.envUint("CLAIM_VALID_UNTIL_BLOCK");

        require(bytes(claimId).length != 0 && bytes(category).length != 0, "EMPTY_CLAIM_FIELD");
        require(amountWei <= type(uint96).max, "CLAIM_AMOUNT_TOO_LARGE");
        require(amountWei <= vault.MAX_NEW_RECIPIENT_PAYOUT(), "CLAIM_OVER_PAYOUT_LIMIT");
        require(validUntilBlockInput <= type(uint64).max, "CLAIM_EXPIRY_TOO_LARGE");
        uint64 validUntilBlock = uint64(validUntilBlockInput);

        bytes32 claimHash = keccak256(bytes(claimId));
        bytes32 evidenceHash = keccak256(abi.encode(
            claimHash,
            keccak256(bytes(category)),
            recipient,
            uint96(amountWei)
        ));

        vm.startBroadcast(pk);
        vault.registerClaim(claimHash, recipient, uint96(amountWei), validUntilBlock, evidenceHash);
        vm.stopBroadcast();

        console2.log("CLAIM_HASH:");
        console2.logBytes32(claimHash);
        console2.log("EVIDENCE_HASH:");
        console2.logBytes32(evidenceHash);
        console2.log("VALID_UNTIL_BLOCK:", uint256(validUntilBlock));
    }
}
