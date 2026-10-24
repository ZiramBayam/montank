// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../src/AegisVault.sol";

interface Vm {
    function deal(address account, uint256 balance) external;
    function roll(uint256 newHeight) external;
}

contract VaultActor {
    receive() external payable {}

    function propose(AegisVault vault, bytes32 id, address to, uint96 amount) external {
        vault.proposeAction(id, to, amount, bytes32(0));
    }

    function vote(AegisVault vault, bytes32 id, bool veto) external {
        vault.submitDecision(id, veto, veto ? 11 : 0);
    }
}

contract RejectingReceiver {
    receive() external payable { revert("NO_PAYMENT"); }
}

contract AegisVaultTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    VaultActor private worker;
    VaultActor private guardian1;
    VaultActor private guardian2;
    VaultActor private guardian3;
    AegisVault private vault;

    function setUp() public {
        worker = new VaultActor();
        guardian1 = new VaultActor();
        guardian2 = new VaultActor();
        guardian3 = new VaultActor();
        address[3] memory guardians = [address(guardian1), address(guardian2), address(guardian3)];
        address[] memory workers = new address[](1);
        workers[0] = address(worker);
        vault = new AegisVault(guardians, workers, 7, 20);
        vm.deal(address(vault), 50 ether);
    }

    function testThreeGuardiansCanVoteInSameBlockAndExecuteOnce() public {
        bytes32 id = keccak256("all-clear");
        worker.propose(vault, id, address(0xBEEF), 1 ether);
        guardian1.vote(vault, id, false);
        guardian1.vote(vault, id, true); // first vote is final
        guardian2.vote(vault, id, false);
        guardian3.vote(vault, id, false);
        vault.executeAction(id);
        vault.executeAction(id);
        (,,,, AegisVault.ActionStatus status,) = vault.actions(id);
        require(status == AegisVault.ActionStatus.EXECUTED, "not executed");
        require(address(0xBEEF).balance == 1 ether, "payout mismatch");
    }

    function testAnyVetoBlocksPayout() public {
        bytes32 id = keccak256("veto");
        worker.propose(vault, id, address(0xBEEF), 1 ether);
        guardian1.vote(vault, id, false);
        guardian2.vote(vault, id, false);
        guardian3.vote(vault, id, true);
        vault.executeAction(id);
        (,,,, AegisVault.ActionStatus status,) = vault.actions(id);
        require(status == AegisVault.ActionStatus.VETOED, "not vetoed");
        require(address(0xBEEF).balance == 0, "vetoed funds paid");
    }

    function testRegisteredPayeeWindowCapBlocksSplitDrainAndResets() public {
        VaultActor payee = new VaultActor();
        vault.registerPayee(address(payee), 3 ether, 5 ether);
        bytes32 first = keccak256("registered-1");
        bytes32 second = keccak256("registered-2");
        worker.propose(vault, first, address(payee), 3 ether);
        worker.propose(vault, second, address(payee), 3 ether);
        (,,,, AegisVault.ActionStatus rejectedStatus,) = vault.actions(second);
        require(rejectedStatus == AegisVault.ActionStatus.NONE, "split drain was not rejected");
        require(address(payee).balance == 3 ether, "unexpected first payout");
        vm.roll(block.number + vault.WINDOW_BLOCKS() + 1);
        worker.propose(vault, second, address(payee), 3 ether);
        require(address(payee).balance == 6 ether, "window did not reset");
    }

    function testFailingRecipientDoesNotRevertAndIsMarkedFailed() public {
        RejectingReceiver recipient = new RejectingReceiver();
        vault.registerPayee(address(recipient), 1 ether, 1 ether);
        bytes32 id = keccak256("receiver-fails");
        worker.propose(vault, id, address(recipient), 1 ether);
        (,,,, AegisVault.ActionStatus status,) = vault.actions(id);
        require(status == AegisVault.ActionStatus.PAYOUT_FAILED, "failed payout not recorded");
    }

    function testExpiredPendingActionFailsClosed() public {
        bytes32 id = keccak256("expires");
        worker.propose(vault, id, address(0xBEEF), 1 ether);
        vm.roll(block.number + 21);
        vault.executeAction(id);
        (,,,, AegisVault.ActionStatus status,) = vault.actions(id);
        require(status == AegisVault.ActionStatus.EXPIRED, "action did not expire");
        require(address(0xBEEF).balance == 0, "expired funds paid");
    }

    function testDuplicateActionIdIsIgnored() public {
        bytes32 id = keccak256("duplicate");
        worker.propose(vault, id, address(0xBEEF), 1 ether);
        worker.propose(vault, id, address(0xCAFE), 2 ether);
        ( , uint96 amount, address recipient, , , ) = vault.actions(id);
        require(amount == 1 ether && recipient == address(0xBEEF), "duplicate action overwrote record");
    }

    function testUnauthorizedWorkerCannotPropose() public {
        bool reverted;
        try vault.proposeAction(keccak256("unauthorized"), address(0xBEEF), 1 ether, bytes32(0)) { }
        catch { reverted = true; }
        require(reverted, "unauthorized worker was accepted");
    }

    function testOneGuardianDeploymentCanExecuteAfterClear() public {
        address[3] memory guardians = [address(guardian1), address(0), address(0)];
        address[] memory workers = new address[](1);
        workers[0] = address(worker);
        AegisVault oneGuard = new AegisVault(guardians, workers, 1, 20);
        vm.deal(address(oneGuard), 1 ether);
        bytes32 id = keccak256("one-guard");
        worker.propose(oneGuard, id, address(0xCAFE), 1 ether);
        guardian1.vote(oneGuard, id, false);
        oneGuard.executeAction(id);
        require(address(0xCAFE).balance == 1 ether, "single guardian payout failed");
    }
}
