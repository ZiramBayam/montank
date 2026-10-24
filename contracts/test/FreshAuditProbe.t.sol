// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AegisVault} from "../src/AegisVault.sol";
import {HappyPayee} from "./Mocks.sol";

/// @title Probe hasil audit kedua (skeptik, ponytail).
/// @dev Tiga klaim yang diuji ulang tanpa percaya tes lama:
///      1. "Total PENDING <= saldo" TIDAK dijamin kontrak - frozen LEGITIM bisa
///         melebihi saldo dan beres PAYOUT_FAILED fail-soft (klaim I1 lama salah).
///      2. Quorum dikunci saat proposal; tidak ada pre-vote dan mask baru tidak
///         mengubah aksi yang sudah PENDING.
contract FreshAuditProbe is Test {
    AegisVault vault;
    HappyPayee payee; // perlu kontrak receive (Jalur B tujuan; payee ringan)

    address g1 = makeAddr("probe_g1");
    address g2 = makeAddr("probe_g2");
    address g3 = makeAddr("probe_g3");
    address w1 = makeAddr("probe_w1");
    address w2 = makeAddr("probe_w2");

    uint256 internal nonce;

    event GuardianDecision(bytes32 indexed actionId, uint8 indexed guardianId, bool isVeto, uint8 reasonCode);
    event ActionResolved(bytes32 indexed actionId, AegisVault.ActionStatus status, uint256 amount);

    function setUp() public {
        address[3] memory gs = [g1, g2, g3];
        address[] memory ws = new address[](2);
        ws[0] = w1;
        ws[1] = w2;
        vault = new AegisVault{value: 1 ether}(gs, ws, 0x7, 20, 200, false);
        payee = new HappyPayee();
    }

    function _nextAid() internal returns (bytes32) {
        return keccak256(abi.encode("probe", ++nonce));
    }

    function _key(bytes32 aid, uint8 gid) internal pure returns (bytes32) {
        return keccak256(abi.encode(aid, gid));
    }

    function _submitClear(address g, bytes32 aid) internal {
        vm.prank(g);
        vault.submitDecision(aid, false, 0);
    }

    function test_frozenOverBalance_resolvesSoftly() public {
        // F-probe-1: DUA klaim PENDING 1 ether masing-masing dengan saldo 1 ether.
        //            Frozen total (2 ether) > saldo (1 ether) = keadaan LEGITIM.
        bytes32 aid1 = _nextAid();
        bytes32 aid2 = _nextAid();
        vm.prank(w1);
        vault.proposeAction(aid1, address(payee), 1 ether, bytes32(0));
        vm.prank(w1);
        vault.proposeAction(aid2, address(payee), 1 ether, bytes32(0));

        (, , , , AegisVault.ActionStatus st1,) = vault.actions(aid1);
        (, , , , AegisVault.ActionStatus st2,) = vault.actions(aid2);
        assertEq(uint8(st1), uint8(1), "aid1 PENDING"); // 1 = PENDING
        assertEq(uint8(st2), uint8(1), "aid2 PENDING");
        // Bukti over-claim I1 lama: dua aksi PENDING x 1 ether vs saldo 1 ether.
        assertEq(address(vault).balance, 1 ether, "saldo tetap 1e; frozen tidak mengescrow");

        // aid1 bayar dulu: 3/3 Clear (mask 7) -> EXECUTED, saldo jadi 0.
        _submitClear(g1, aid1);
        _submitClear(g2, aid1);
        _submitClear(g3, aid1);
        vault.executeAction(aid1);
        (, , , , AegisVault.ActionStatus st1After,) = vault.actions(aid1);
        assertEq(uint8(st1After), uint8(3), "aid1 EXECUTED"); // 3 = EXECUTED
        assertEq(address(payee).balance, 1 ether, "aid1 cair penuh");
        assertEq(address(vault).balance, 0 ether, "saldo 0");

        // aid2 quorum penuh JUGA -> eksekusi -> saldo kurang -> PAYOUT_FAILED.
        _submitClear(g1, aid2);
        _submitClear(g2, aid2);
        _submitClear(g3, aid2);
        vm.expectEmit(true, false, false, true, address(vault));
        emit ActionResolved(aid2, AegisVault.ActionStatus.PAYOUT_FAILED, 1 ether);
        vault.executeAction(aid2);
        (, , , , AegisVault.ActionStatus st2After,) = vault.actions(aid2);
        assertEq(uint8(st2After), uint8(5), "aid2 PAYOUT_FAILED (fail-soft, tanpa revert)"); // 5 = PAYOUT_FAILED
        assertEq(address(vault).balance, 0 ether, "tidak ada saldo minus");
    }

    function test_proposalSnapshot_rejectsPreVotesAndLocksQuorum() public {
        address[3] memory gs = [g1, g2, g3];
        address[] memory ws = new address[](2);
        ws[0] = w1;
        ws[1] = w2;
        AegisVault v = new AegisVault{value: 5 ether}(gs, ws, 0x1, 50, 200, false); // P0 = 0b001

        // Pre-vote tidak boleh tersimpan sebelum proposal ada.
        bytes32 unknownAid = _nextAid();
        vm.prank(g1);
        v.submitDecision(unknownAid, false, 0);
        assertEq(v.decision(_key(unknownAid, 1)), uint8(0), "pre-vote ignored");

        // Proposal dibuat dengan mask 0x1. G2 tidak boleh mengisi slot.
        bytes32 aid = _nextAid();
        vm.prank(w1);
        v.proposeAction(aid, address(payee), 1 ether, bytes32(0));
        vm.prank(g2);
        v.submitDecision(aid, false, 0);
        assertEq(v.decision(_key(aid, 2)), uint8(0), "outside-snapshot vote ignored");
        vm.prank(g1);
        v.submitDecision(aid, false, 0);
        v.setGuardianMask(0x7);
        assertEq(v.actionGuardianMask(aid), uint8(0x1), "old action keeps original mask");
        v.executeAction(aid);
        (, , , , AegisVault.ActionStatus stPaidP0,) = v.actions(aid);
        assertEq(uint8(stPaidP0), uint8(3), "P0 proposal still uses 0x1"); // 3 = EXECUTED

        // Proposal setelah ekspansi wajib mendapat 3 Clear.
        bytes32 aid2 = _nextAid();
        vm.prank(w1);
        v.proposeAction(aid2, address(payee), 1 ether, bytes32(0));
        assertEq(v.actionGuardianMask(aid2), uint8(0x7), "new action snapshots 0x7");
        vm.prank(g1);
        v.submitDecision(aid2, false, 0);
        vm.prank(g2);
        v.submitDecision(aid2, false, 0);
        v.executeAction(aid2);
        (, , , , AegisVault.ActionStatus stPending,) = v.actions(aid2);
        assertEq(uint8(stPending), uint8(1), "2/3 Clear stays pending"); // 1 = PENDING
        vm.prank(g3);
        v.submitDecision(aid2, false, 0);
        v.executeAction(aid2);
        (, , , , AegisVault.ActionStatus stPaidP1,) = v.actions(aid2);
        assertEq(uint8(stPaidP1), uint8(3), "3/3 Clear pays"); // 3 = EXECUTED
        assertEq(address(payee).balance, 2 ether, "both approved actions paid");
    }

}
