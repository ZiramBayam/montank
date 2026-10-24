// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../src/AegisVault.sol";

interface Vm {
    function envUint(string calldata key) external returns (uint256);
    function envAddress(string calldata key) external returns (address);
    function envOr(string calldata key, address defaultValue) external returns (address);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

contract DeployAegisVault {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run() external returns (AegisVault vault) {
        address[3] memory guardians = [
            vm.envAddress("GUARDIAN_1_ADDRESS"),
            vm.envOr("GUARDIAN_2_ADDRESS", address(0)),
            vm.envOr("GUARDIAN_3_ADDRESS", address(0))
        ];
        address[] memory workers = new address[](1);
        workers[0] = vm.envAddress("WORKER_1_ADDRESS");
        uint8 guardianMask = uint8(vm.envUint("GUARDIAN_MASK"));
        uint64 expiryBlocks = uint64(vm.envUint("AEGIS_EXPIRY_BLOCKS"));

        vm.startBroadcast(vm.envUint("DEPLOYER_PRIVATE_KEY"));
        vault = new AegisVault(guardians, workers, guardianMask, expiryBlocks);
        vm.stopBroadcast();
    }
}
