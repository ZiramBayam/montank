// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AegisVault} from "../src/AegisVault.sol";
import {HappyPayee, RevertingPayee, GasBurnerPayee, ReentrantPayee} from "./Mocks.sol";

/// @title Unit tests AegisVault - Grup A–E + F (red-team) sesuai docs/03-foundry-tests-checklist.md
///        (§5.3 PRD + tambahan dari keputusan desain docs/01).
/// @dev Catatan penting: vault di-deploy oleh contract tes ini → vault.owner() == address(this).
///      Semua panggilan admin TANPA prank; prank hanya untuk role worker/guardian/pemanggil lain.
contract AegisVaultTest is Test {
    AegisVault internal vault;

    uint64 internal constant EXP = 100;
    uint64 internal constant WIN = 200;

    uint96 internal constant ST_NONE = 0;
    uint96 internal constant ST_PENDING = 1;
    uint96 internal constant ST_VETOED = 2;
    uint96 internal constant ST_EXECUTED = 3;
    uint96 internal constant ST_EXPIRED = 4;
    uint96 internal constant ST_PAYOUT_FAILED = 5;

    address internal g1;
    address internal g2;
    address internal g3;
    address internal w1;
    address internal w2;
    address internal rando;

    HappyPayee internal happy;
    RevertingPayee internal badRecv;
    GasBurnerPayee internal burner;
    ReentrantPayee internal rePick;

    uint256 internal internalNonce;

    // Mirror event untuk vm.expectEmit (signature & posisi index HARUS identik)
    event ActionProposed(bytes32 indexed actionId, address indexed to, uint256 amount, uint64 expireBlock, bytes32 intentHash);
    event Layer0Rejected(bytes32 indexed actionId, address indexed to, uint256 amount, uint8 reasonCode);
    event GuardianDecision(bytes32 indexed actionId, uint8 indexed guardianId, bool isVeto, uint8 reasonCode);
    event GuardianMaskChanged(uint8 oldMask, uint8 newMask);

    function setUp() public {
        g1 = makeAddr("guardian1");
        g2 = makeAddr("guardian2");
        g3 = makeAddr("guardian3");
        w1 = makeAddr("worker1");
        w2 = makeAddr("worker2");
        rando = makeAddr("rando");

        vm.deal(address(this), 1000 ether);

        vault = _deployVault(0x7, 100 ether, EXP, WIN); // 0x7 = 0x7

        happy = new HappyPayee();
        badRecv = new RevertingPayee();
        burner = new GasBurnerPayee();
        rePick = new ReentrantPayee(vault);
    }

    // ----------------------------------------------------------------- Helpers
    function _deployVault(uint8 mask, uint256 fund, uint64 exp, uint64 win) internal returns (AegisVault v) {
        address[3] memory gs = [g1, g2, g3];
        address[] memory ws = new address[](2);
        ws[0] = w1;
        ws[1] = w2;
        v = new AegisVault{value: fund}(gs, ws, mask, exp, win, false);
    }

    function _deployVault(uint8 mask) internal returns (AegisVault v) {
        v = _deployVault(mask, 100 ether, EXP, WIN);
    }

    function _nextAid() internal returns (bytes32) {
        ++internalNonce;
        return keccak256(abi.encode(uint256(987_654_321), internalNonce));
    }

    function _key(bytes32 aid, uint8 gid) internal pure returns (bytes32) {
        return keccak256(abi.encode(aid, gid));
    }

    function _g(uint8 gid) internal view returns (address) {
        if (gid == 1) return g1;
        if (gid == 2) return g2;
        return g3;
    }

    function _propose(bytes32 aid, address to, uint96 amt, address by) internal {
        vm.prank(by);
        vault.proposeAction(aid, to, amt, bytes32(0));
    }

    function _newRecipient(uint256 seed) internal pure returns (address) {
        return address(uint160(0xC0FFEE00 + seed));
    }

    function _proposeNew(uint96 amt) internal returns (bytes32 aid, address to) {
        aid = _nextAid();
        to = _newRecipient(internalNonce + 1);
        _propose(aid, to, amt, w1);
    }

    function _submit(uint8 gid, bytes32 aid, bool veto) internal {
        vm.prank(_g(gid));
        vault.submitDecision(aid, veto, 0);
    }

    function _payeeState(address p) internal view returns (uint96 perTx, uint96 perWin, uint96 spent, uint64 ws) {
        (, perTx, perWin, spent, ws) = vault.payees(p);
    }

    // ----------------------------------------------------------------- Grup A - submitDecision
    function test_submitDecision_threeGuardsSameBlock_allRecorded() public {
        // A1: 3 penjaga satu blok - tidak ada revert, tiga slot terisi (bukti no-hot-slot PRD §3.4)
        (bytes32 aid,) = _proposeNew(1 ether);
        _submit(1, aid, false);
        _submit(2, aid, false);
        _submit(3, aid, false);

        assertEq(vault.decision(_key(aid, 1)), uint8(1), "g1");
        assertEq(vault.decision(_key(aid, 2)), uint8(1), "g2");
        assertEq(vault.decision(_key(aid, 3)), uint8(1), "g3");
    }

    function test_submitDecision_duplicateIsNoOp_voteIsFinal() public {
        // A2: suara pertama final; submit kedua = no-op (tidak revert, tidak menimpa)
        (bytes32 aid,) = _proposeNew(1 ether);
        _submit(1, aid, false);
        assertEq(vault.decision(_key(aid, 1)), uint8(1), "after clear");

        vm.prank(g1);
        vault.submitDecision(aid, true, 9); // coba ganti suara → diabaikan

        assertEq(vault.decision(_key(aid, 1)), uint8(1), "vote must not change");
    }

    function test_submitDecision_revertsForNonGuardian() public {
        // A3: pemanggil bukan penjaga → revert sah
        (bytes32 aid,) = _proposeNew(1 ether);
        vm.prank(rando);
        vm.expectRevert("NOT_GUARDIAN");
        vault.submitDecision(aid, false, 0);
    }

    function test_submitDecision_outsideMask_isIgnored() public {
        // A4 (docs/01 B2): mask 0b001 - suara G2 di luar snapshot tidak mengisi slot
        AegisVault v1 = _deployVault(0x1); // 0x1 = 0b001
        bytes32 aid = _nextAid();
        address to = _newRecipient(42);
        vm.prank(w1);
        v1.proposeAction(aid, to, 0.1 ether, bytes32(0));

        vm.prank(g2); // penjaga #2 di luar mask
        v1.submitDecision(aid, false, 0);
        assertEq(v1.decision(_key(aid, 2)), uint8(0), "outside-snapshot vote ignored");

        vm.roll(uint64(block.number) + EXP + 1);
        v1.executeAction(aid);

        (, , , , AegisVault.ActionStatus st,) = v1.actions(aid);
        assertEq(uint8(st), uint8(uint96(ST_EXPIRED)), "EXPIRED - clear di luar mask tidak dihitung");
        assertEq(to.balance, 0, "frozen");
    }

    // ----------------------------------------------------------------- Grup B - executeAction
    function test_executeAction_oneVetoBlocksPayout() public {
        // B1: 2 Clear + 1 Veto → VETOED, tanpa pembayaran
        (bytes32 aid, address to) = _proposeNew(1 ether);
        _submit(1, aid, false);
        _submit(2, aid, false);
        _submit(3, aid, true);

        uint256 vaultBefore = address(vault).balance;
        uint256 toBefore = to.balance;

        vault.executeAction(aid);

        (, , , , AegisVault.ActionStatus st,) = vault.actions(aid);
        assertEq(uint8(st), uint8(uint96(ST_VETOED)), "VETOED");
        assertEq(address(vault).balance, vaultBefore, "vault intact");
        assertEq(to.balance, toBefore, "payee intact");
    }

    function test_executeAction_paysOnThreeClears_thenNoOp() public {
        // B2: 3/3 Clear → cair; panggilan kedua no-op (tanpa double-pay)
        (bytes32 aid, address to) = _proposeNew(1 ether);
        _submit(1, aid, false);
        _submit(2, aid, false);
        _submit(3, aid, false);

        vault.executeAction(aid);
        assertEq(to.balance, 1 ether, "paid once");

        vault.executeAction(aid); // idempotent
        assertEq(to.balance, 1 ether, "no double pay");
    }

    function test_executeAction_permissionless() public {
        // B3: siapa pun boleh memanggil executeAction
        (bytes32 aid, address to) = _proposeNew(1 ether);
        _submit(1, aid, false);
        _submit(2, aid, false);
        _submit(3, aid, false);

        vm.prank(rando);
        vault.executeAction(aid);
        assertEq(to.balance, 1 ether, "paid by random caller");
    }

    function test_executeAction_incomplete_staysPending() public {
        // B4: belum bulat + belum expire → no-op, masih PENDING
        (bytes32 aid,) = _proposeNew(1 ether);
        _submit(1, aid, false);

        vault.executeAction(aid);
        (, , , , AegisVault.ActionStatus st,) = vault.actions(aid);
        assertEq(uint8(st), uint8(uint96(ST_PENDING)), "still PENDING");
    }

    function test_executeAction_incompletePastExpire_failsClosed() public {
        // B5: belum bulat + lewat expire → EXPIRED; dana tidak keluar (fail-closed B1)
        (bytes32 aid, address to) = _proposeNew(1 ether);
        _submit(1, aid, false);

        vm.roll(EXP + 2);
        vault.executeAction(aid);

        (, , , , AegisVault.ActionStatus st,) = vault.actions(aid);
        assertEq(uint8(st), uint8(uint96(ST_EXPIRED)), "EXPIRED");
        assertEq(to.balance, 0, "no funds out");
    }

    function test_executeAction_completePastExpire_stillPaid() public {
        // B6 (docs/01): fast path menang atas expire - putusan lengkap tetap cair
        (bytes32 aid, address to) = _proposeNew(1 ether);
        _submit(1, aid, false);
        _submit(2, aid, false);
        _submit(3, aid, false);

        vm.roll(EXP + 2);
        vault.executeAction(aid);

        assertEq(to.balance, 1 ether, "paid despite late execution");
    }

    function test_executeAction_mask001_quorumIsOne() public {
        // B7 (docs/01 B2): mask 0b001 - Clear G1 saja cukup; Veto G1 menahan walau G2/G3 Clear
        AegisVault v1 = _deployVault(0x1);

        bytes32 aid = _nextAid();
        address to = _newRecipient(101);
        vm.prank(w1);
        v1.proposeAction(aid, to, 1 ether, bytes32(0));

        vm.prank(g1);
        v1.submitDecision(aid, false, 0);
        v1.executeAction(aid);
        assertEq(to.balance, 1 ether, "single clear pays under mask 0b001");

        bytes32 aid2 = _nextAid();
        address to2 = _newRecipient(202);
        vm.prank(w1);
        v1.proposeAction(aid2, to2, 1 ether, bytes32(0));

        vm.prank(g2);
        v1.submitDecision(aid2, false, 0);
        vm.prank(g3);
        v1.submitDecision(aid2, false, 0);
        vm.prank(g1);
        v1.submitDecision(aid2, true, 0);

        v1.executeAction(aid2);
        (, , , , AegisVault.ActionStatus st2,) = v1.actions(aid2);
        assertEq(uint8(st2), uint8(uint96(ST_VETOED)), "single veto holds under 0b001");
        assertEq(to2.balance, 0, "frozen");
    }

    function test_setGuardianMask_p0ToP1_withoutRedeploy() public {
        // B9 (docs/01 B2): P0 mask 0x1 -> owner naikkan ke 0x7 TANPA redeploy ->
        // quorum langsung berubah jadi 3 penjaga aktif untuk aksi BERIKUTNYA.
        AegisVault v1 = _deployVault(0x1); // P0

        vm.expectEmit(false, false, false, true, address(v1));
        emit GuardianMaskChanged(0x1, 0x7);
        v1.setGuardianMask(0x7);
        assertEq(v1.guardianMask(), uint8(0x7), "mask changed live");

        // Aksi pertama setelahnya kena quorum baru
        bytes32 aid = _nextAid();
        address to = _newRecipient(303);
        vm.prank(w1);
        v1.proposeAction(aid, to, 1 ether, bytes32(0));

        vm.prank(g2);
        v1.submitDecision(aid, false, 0);
        vm.prank(g3);
        v1.submitDecision(aid, false, 0);
        v1.executeAction(aid);
        (, , , , AegisVault.ActionStatus st1,) = v1.actions(aid);
        assertEq(uint8(st1), uint8(uint96(ST_PENDING)), "0x7: 2 Clear belum cukup");

        vm.prank(g1);
        v1.submitDecision(aid, false, 0);
        v1.executeAction(aid);
        assertEq(to.balance, 1 ether, "3/3 under mask 0x7 pays");

        // Validasi setter: 0 / >0x7 -> revert; non-owner -> revert
        vm.expectRevert("BAD_MASK");
        v1.setGuardianMask(0);
        vm.expectRevert("BAD_MASK");
        v1.setGuardianMask(0x8);
        vm.prank(w1);
        vm.expectRevert("NOT_OWNER");
        v1.setGuardianMask(0x7);
    }

    function test_executeAction_silentGuard_neverPays() public {
        // B8 (docs/01 B1): 2 Clear + 1 penjaga diam + lewat expire -> EXPIRED, bukan cair
        (bytes32 aid, address to) = _proposeNew(1 ether);
        _submit(1, aid, false);
        _submit(2, aid, false);
        // g3 tidak pernah submit (simulasi penjaga mati / di-DDoS)

        vm.roll(EXP + 2);
        vault.executeAction(aid);

        (, , , , AegisVault.ActionStatus st,) = vault.actions(aid);
        assertEq(uint8(st), uint8(uint96(ST_EXPIRED)), "fail-closed");
        assertEq(to.balance, 0, "no payout");
    }

    // ----------------------------------------------------------------- Grup C - _pay & payee jahat
    function test_pay_revertingPayee_payoutFailed_notReverted() public {
        // C1: penerima revert → PAYOUT_FAILED; tx worker sukses; dana tetap di brankas
        vault.registerPayee(address(badRecv), 2 ether, 4 ether);

        bytes32 aid = _nextAid();
        vm.prank(w1);
        vault.proposeAction(aid, address(badRecv), 1 ether, bytes32(0));

        (, , , , AegisVault.ActionStatus st,) = vault.actions(aid);
        assertEq(uint8(st), uint8(uint96(ST_PAYOUT_FAILED)), "PAYOUT_FAILED");
        assertEq(address(badRecv).balance, 0, "nothing received");
        assertEq(address(vault).balance, 100 ether, "funds stay in vault");
    }

    function test_pay_gasBurnerPayee_payoutFailed_notReverted() public {
        // C2: penerima membakar gas → dipotong PAYOUT_GAS_CAP → PAYOUT_FAILED
        vault.registerPayee(address(burner), 2 ether, 4 ether);

        bytes32 aid = _nextAid();
        vm.prank(w1);
        vault.proposeAction(aid, address(burner), 1 ether, bytes32(0));

        (, , , , AegisVault.ActionStatus st,) = vault.actions(aid);
        assertEq(uint8(st), uint8(uint96(ST_PAYOUT_FAILED)), "PAYOUT_FAILED");
        assertEq(address(burner).balance, 0, "nothing received");
        assertEq(address(vault).balance, 100 ether, "vault intact");
    }

    function test_pay_insufficientBalance_payoutFailed() public {
        // C3: saldo kurang → PAYOUT_FAILED sebelum bahkan memanggil penerima
        AegisVault v1 = _deployVault(0x7, 0.5 ether, EXP, WIN);

        v1.registerPayee(address(happy), 5 ether, 10 ether);

        bytes32 aid = _nextAid();
        vm.prank(w1);
        v1.proposeAction(aid, address(happy), 2 ether, bytes32(0));

        (, , , , AegisVault.ActionStatus st,) = v1.actions(aid);
        assertEq(uint8(st), uint8(uint96(ST_PAYOUT_FAILED)), "PAYOUT_FAILED on low-balance vault");
        assertEq(address(happy).balance, 0, "no partial transfer");
    }

    function test_reentrantPayee_reenterExecute_duringPayout() public {
        // C4 (Red-team F4): payee reenter executeAction saat dibayar → guard mem-veto call → PAYOUT_FAILED.
        // Kontras: dengan mode None pembayaran normal sukses (buktikan payee bekerja normal).
        // Catatan: state `tries` di dalam frame call yang GAGAL ikut di-revert (semantik EVM).

        // Kasus 1 - mode None → pembayaran normal
        bytes32 aidOk = _nextAid();
        vm.prank(w1);
        vault.proposeAction(aidOk, address(rePick), 1 ether, bytes32(0));
        _submit(1, aidOk, false);
        _submit(2, aidOk, false);
        _submit(3, aidOk, false);
        vault.executeAction(aidOk);

        assertEq(address(rePick).balance, 1 ether, "baseline paid");
        assertEq(rePick.tries(), 1, "receive executed once");

        // Kasus 2 - mode Reexecute → reentry ditolak guard → call gagal → PAYOUT_FAILED
        rePick.setAttack(ReentrantPayee.Mode.Reexecute, bytes32(0), address(0), 0);
        bytes32 aidBad = _nextAid();
        vm.prank(w1);
        vault.proposeAction(aidBad, address(rePick), 1 ether, bytes32(0));
        _submit(1, aidBad, false);
        _submit(2, aidBad, false);
        _submit(3, aidBad, false);

        uint256 vaultAfterCase1 = address(vault).balance;
        vault.executeAction(aidBad);

        (, , , uint64 eb, AegisVault.ActionStatus st,) = vault.actions(aidBad);
        assertNotEq(eb, 0, "Jalur B action");
        assertEq(uint8(st), uint8(uint96(ST_PAYOUT_FAILED)), "PAYOUT_FAILED (reentry diblok guard)");
        assertEq(address(rePick).balance, 1 ether, "hanya pembayaran baseline");
        assertEq(rePick.tries(), 1, "state dalam frame gagal ikut di-revert");
        assertEq(address(vault).balance, vaultAfterCase1, "vault intact");
    }

    function test_reentrantPayee_reenterPropose_duringJalurA() public {
        // C5 (Red-team): payee Jalur A reenter proposeAction saat dibayar → guard → PAYOUT_FAILED
        vault.registerPayee(address(rePick), 2 ether, 4 ether);
        rePick.setAttack(ReentrantPayee.Mode.Repropose, _nextAid(), address(happy), 0.1 ether);

        uint256 vaultBefore = address(vault).balance;
        bytes32 aid = _nextAid();
        vm.prank(w1);
        vault.proposeAction(aid, address(rePick), 1 ether, bytes32(0));

        (, , , , AegisVault.ActionStatus st,) = vault.actions(aid);
        assertEq(uint8(st), uint8(uint96(ST_PAYOUT_FAILED)), "PAYOUT_FAILED (guard mematikan reentry)");
        (, , uint96 spent, ) = _payeeState(address(rePick));
        assertEq(spent, 1 ether, "window accounting tetap (CEI)");
        assertEq(address(vault).balance, vaultBefore, "vault balance unchanged");
    }

    // ----------------------------------------------------------------- Grup D - proposeAction / Layer 0 / registri
    function test_propose_splitDrainCaughtByWindowCap() public {
        // D1: 3 tx kecil lolos; tx ke-4 melebihi kumulatif → R_OVER_WINDOW_CAP (tanpa revert)
        vault.registerPayee(address(happy), 1 ether, 3 ether);

        for (uint256 i = 0; i < 3; ++i) {
            bytes32 id = _nextAid();
            vm.prank(w1);
            vault.proposeAction(id, address(happy), 1 ether, bytes32(0));
        }
        assertEq(address(happy).balance, 3 ether, "tiga kali cair");

        bytes32 aid4 = _nextAid();
        vm.prank(w1);
        vm.expectEmit(true, true, false, true, address(vault));
        emit Layer0Rejected(aid4, address(happy), 1 ether, 4);
        vault.proposeAction(aid4, address(happy), 1 ether, bytes32(0));

        (, , , , AegisVault.ActionStatus st,) = vault.actions(aid4);
        assertEq(uint8(st), uint8(uint96(ST_NONE)), "penolakan tidak menyimpan state");
        assertEq(address(happy).balance, 3 ether, "total tidak berubah");
    }

    function test_propose_windowResetsAfterExpiry() public {
        // D2: setelah jendela habis → akumulasi direset; klaim berikutnya lolos
        vault.registerPayee(address(happy), 1 ether, 2 ether);

        bytes32 a1 = _nextAid();
        vm.prank(w1);
        vault.proposeAction(a1, address(happy), 1 ether, bytes32(0));
        assertEq(address(happy).balance, 1 ether, "first paid");
        assertEq(address(this).balance, 900 ether, "vault debited from this");

        bytes32 a2 = _nextAid();
        vm.prank(w1);
        vault.proposeAction(a2, address(happy), 1 ether, bytes32(0)); // spent 1+1 =2 jenuh

        bytes32 a3 = _nextAid();
        vm.prank(w1);
        vm.expectEmit(true, true, false, true, address(vault));
        emit Layer0Rejected(a3, address(happy), 1 ether, 4);
        vault.proposeAction(a3, address(happy), 1 ether, bytes32(0)); // 2+1 >2 → tolak

        (, , uint96 spentBefore, uint64 ws) = _payeeState(address(happy));
        assertEq(spentBefore, 2 ether, "window penuh");
        vm.roll(uint256(ws) + WIN);

        bytes32 a4 = _nextAid();
        vm.prank(w1);
        vault.proposeAction(a4, address(happy), 1 ether, bytes32(0)); // reset → lolos
        assertEq(address(happy).balance, 3 ether, "setelah reset cair lagi");
        (, , uint96 spentAfter, uint64 wsAfter) = _payeeState(address(happy));
        assertEq(spentAfter, 1 ether, "jendela baru: 1");
        assertEq(wsAfter, uint64(1) + WIN, "windowStart moved to roll block");
    }

    function test_propose_perTx_and_jalurB_caps() public {
        // D3: melebihi per-tx (Jalur A) & MAX_NEW_RECIPIENT_PAYOUT (Jalur B)
        vault.registerPayee(address(happy), 1 ether, 100 ether);

        bytes32 aidA = _nextAid();
        vm.prank(w1);
        vm.expectEmit(true, true, false, true, address(vault));
        emit Layer0Rejected(aidA, address(happy), 2 ether, 3);
        vault.proposeAction(aidA, address(happy), 2 ether, bytes32(0));

        bytes32 aidB = _nextAid();
        vm.prank(w1);
        vm.expectEmit(true, true, false, true, address(vault));
        emit Layer0Rejected(aidB, _newRecipient(1), 5.1 ether, 3);
        vault.proposeAction(aidB, _newRecipient(1), 5.1 ether, bytes32(0));
    }

    function test_propose_zeroAddr_zeroAmount_rejectWithEvents() public {
        // D4: Layer 0 dasar - tanpa state tersimpan, hanya event
        bytes32 a1 = _nextAid();
        vm.prank(w1);
        vm.expectEmit(true, true, false, true, address(vault));
        emit Layer0Rejected(a1, address(0), 0.1 ether, 1);
        vault.proposeAction(a1, address(0), 0.1 ether, bytes32(0));

        bytes32 a2 = _nextAid();
        vm.prank(w1);
        vm.expectEmit(true, true, false, true, address(vault));
        emit Layer0Rejected(a2, _newRecipient(5), 0, 2);
        vault.proposeAction(a2, _newRecipient(5), 0, bytes32(0));
    }

    function test_propose_jalurA_paysInstantly() public {
        // D5: cair instan Jalur A - satu tx: propose = EXECUTED, expireBlock 0
        vault.registerPayee(address(happy), 1 ether, 2 ether);
        bytes32 aid = _nextAid();
        vm.prank(w1);
        vault.proposeAction(aid, address(happy), 1 ether, bytes32(0));

        (, , address to, uint64 eb, AegisVault.ActionStatus st,) = vault.actions(aid);
        assertEq(uint8(st), uint8(uint96(ST_EXECUTED)), "EXECUTED");
        assertEq(eb, 0, "expireBlock 0");
        assertEq(to, address(happy), "to recorded");
        assertEq(address(happy).balance, 1 ether, "paid dalam tx yang sama");
    }

    function test_propose_jalurB_pending_noPay() public {
        // D6: Jalur B = PENDING + expire set; TIDAK ada transfer
        (bytes32 aid, address to) = _proposeNew(0.5 ether);

        (, , , uint64 eb, AegisVault.ActionStatus st,) = vault.actions(aid);
        assertEq(uint8(st), uint8(uint96(ST_PENDING)), "PENDING");
        assertEq(eb, uint64(block.number) + EXP, "expire set");
        assertEq(to.balance, 0, "tidak ada transfer");
    }

    function test_propose_duplicateActionId_isNoOp() public {
        // D7: ID duplikat (worker lain) = no-op; aksi pertama menang
        (bytes32 aid, address to) = _proposeNew(1 ether);
        _submit(1, aid, false);
        _submit(2, aid, false);
        _submit(3, aid, false);

        vm.prank(w2);
        vault.proposeAction(aid, _newRecipient(999), 0.5 ether, bytes32(uint256(1)));

        (, , , , AegisVault.ActionStatus st,) = vault.actions(aid);
        assertEq(uint8(st), uint8(uint96(ST_PENDING)), "aksi pertama menang (status tidak berubah)");

        vault.executeAction(aid);
        assertEq(to.balance, 1 ether, "aksi pertama terbayar normal");
    }

    function test_propose_revertsForNonWorker() public {
        // D8: satu-satunya require yang boleh revert di proposeAction
        bytes32 aid = _nextAid();
        vm.prank(rando);
        vm.expectRevert("NOT_WORKER");
        vault.proposeAction(aid, address(happy), 1 ether, bytes32(0));
    }

    function test_registerPayee_upsert_keepsWindow() public {
        // D9 (docs/01 B6): register ulang = update caps TANPA reset akumulasi jendela
        vault.registerPayee(address(happy), 1 ether, 2 ether);

        bytes32 aid = _nextAid();
        vm.prank(w1);
        vault.proposeAction(aid, address(happy), 1 ether, bytes32(0)); // paid; spent = 1

        (, , uint96 spentBefore, uint64 wsBefore) = _payeeState(address(happy));
        assertEq(spentBefore, 1 ether, "spent sebelum upsert");

        vm.roll(5);
        vault.registerPayee(address(happy), 5 ether, 10 ether);

        (uint96 perTxAfter, uint96 perWinAfter, uint96 spentAfter, uint64 wsAfter) = _payeeState(address(happy));
        assertEq(perTxAfter, 5 ether, "perTx updated");
        assertEq(perWinAfter, 10 ether, "perWin updated");
        assertEq(spentAfter, 1 ether, "spent dipertahankan");
        assertEq(wsAfter, wsBefore, "windowStart dipertahankan");

        vm.prank(w1); // non-owner
        vm.expectRevert("NOT_OWNER");
        vault.registerPayee(address(happy), 1 ether, 1 ether);
    }

    function test_setWorker_rotation() public {
        // D10: setWorker on/off oleh owner; worker nonaktif tidak bisa propose;
        //      aksi lama tetap bisa diproses (worker-independent)
        vault.setWorker(w2, false);

        bytes32 aid2 = _nextAid();
        vm.prank(w2);
        vm.expectRevert("NOT_WORKER");
        vault.proposeAction(aid2, _newRecipient(7), 0.1 ether, bytes32(0));

        (bytes32 aid, address to) = _proposeNew(1 ether); // oleh w1
        _submit(1, aid, false);
        _submit(2, aid, false);
        _submit(3, aid, false);
        vault.executeAction(aid);
        assertEq(to.balance, 1 ether, "aksi lama tetap dihormati");

        vault.setWorker(w2, true); // nonaktif → aktif lagi
        bytes32 aid3 = _nextAid();
        vm.prank(w2);
        vault.proposeAction(aid3, _newRecipient(8), 0.1 ether, bytes32(0));
        (, , , , AegisVault.ActionStatus st,) = vault.actions(aid3);
        assertEq(uint8(st), uint8(uint96(ST_PENDING)), "worker aktif lagi");
    }

    // ----------------------------------------------------------------- Grup E - constructor & edge
    function test_constructor_badMask() public {
        // E1: mask 0 / >0x7 → revert
        address[3] memory gs = [g1, g2, g3];
        address[] memory ws = new address[](2);
        ws[0] = w1;
        ws[1] = w2;

        vm.expectRevert("BAD_MASK");
        new AegisVault{value: 0}(gs, ws, 0, EXP, WIN, false);

        vm.expectRevert("BAD_MASK");
        new AegisVault{value: 0}(gs, ws, 0x8, EXP, WIN, false); // 0x8 = 0b1000
    }

    function test_constructor_badCalibration() public {
        // E2b: expiryBlocks/windowBlocks nol atau > 1e9 -> revert
        // (batas 1e9 juga menjamin block.number + expiry tak pernah overflow uint64)
        address[3] memory gs = [g1, g2, g3];
        address[] memory ws = new address[](2);
        ws[0] = w1;
        ws[1] = w2;

        vm.expectRevert("BAD_EXPIRY");
        new AegisVault{value: 0}(gs, ws, 0x7, 0, WIN, false);

        vm.expectRevert("BAD_EXPIRY");
        new AegisVault{value: 0}(gs, ws, 0x7, 1e9 + 1, WIN, false);

        vm.expectRevert("BAD_WINDOW");
        new AegisVault{value: 0}(gs, ws, 0x7, EXP, 0, false);

        vm.expectRevert("BAD_WINDOW");
        new AegisVault{value: 0}(gs, ws, 0x7, EXP, 1e9 + 1, false);
    }

    function test_constructor_badGuardiansAndWorkers() public {
        // E2: guardian nol / duplikat; worker nol
        address[3] memory gs = [g1, g2, g3];
        address[] memory ws = new address[](1);
        ws[0] = w1;

        vm.expectRevert("ZERO_GUARDIAN");
        new AegisVault{value: 0}([address(0), g2, g3], ws, 0x7, EXP, WIN, false);

        vm.expectRevert("DUP_GUARDIAN");
        new AegisVault{value: 0}([g1, g1, g3], ws, 0x7, EXP, WIN, false);

        address[] memory ws0 = new address[](1);
        ws0[0] = address(0);
        vm.expectRevert("ZERO_WORKER");
        new AegisVault{value: 0}(gs, ws0, 0x7, EXP, WIN, false);
    }

    function test_executeAction_exactExpireBlock_isExpired() public {
        // E3: tepat di blok expire (belum bulat) → EXPIRED
        (, bytes32 aid) = (bytes32(0), _nextAid());
        address to = _newRecipient(77);
        vm.prank(w1);
        vault.proposeAction(aid, to, 1 ether, bytes32(0));

        _submit(1, aid, false);

        (, , , uint64 eb, ,) = vault.actions(aid);
        vm.roll(uint256(eb));
        vault.executeAction(aid);

        (, , , , AegisVault.ActionStatus st,) = vault.actions(aid);
        assertEq(uint8(st), uint8(uint96(ST_EXPIRED)), "EXPIRED tepat di expireBlock");
    }

    // ----------------------------------------------------------------- Grup F - red-team (docs/03 tambahan)
    function test_redTeam_executeNoOpsInterleaved_vetoHoldsLast() public {
        // F1: execute sebelum/di antara votes semuanya no-op; VETO terakhir menahan
        (bytes32 aid, address to) = _proposeNew(1 ether);

        vault.executeAction(aid); // tanpa suara → no-op
        _submit(1, aid, false);
        vault.executeAction(aid); // 1 Clear → no-op
        _submit(2, aid, false);
        vault.executeAction(aid); // 2 Clear → no-op
        _submit(3, aid, true);
        vault.executeAction(aid); // Veto → VETOED

        (, , , , AegisVault.ActionStatus st,) = vault.actions(aid);
        assertEq(uint8(st), uint8(uint96(ST_VETOED)), "VETOED");
        assertEq(to.balance, 0, "tidak pernah cair");
    }

    function test_redTeam_perWindowBelowPerTx_stillRejects() public {
        // F2: konfigurasi cap salah (perWindow < perTx) → tetap ditolak, jangan cair
        vault.registerPayee(address(happy), 5 ether, 1 ether);

        bytes32 aid = _nextAid();
        vm.prank(w1);
        vm.expectEmit(true, true, false, true, address(vault));
        emit Layer0Rejected(aid, address(happy), 3 ether, 4);
        vault.proposeAction(aid, address(happy), 3 ether, bytes32(0));

        assertEq(address(happy).balance, 0, "tidak cair");
    }

    function test_redTeam_guardianChangeOfHeart_ignored() public {
        // F3: guardian clear lalu coba veto → diabaikan; keputusan tetap Clear
        (bytes32 aid, address to) = _proposeNew(1 ether);
        _submit(1, aid, false);
        vm.prank(g1);
        vault.submitDecision(aid, true, 7); // no-op

        assertEq(vault.decision(_key(aid, 1)), uint8(1), "tetap Clear");

        _submit(2, aid, false);
        _submit(3, aid, false);
        vault.executeAction(aid);
        assertEq(to.balance, 1 ether, "dibayar sesuai suara pertama");
    }

    function test_redTeam_workerRotated_midExecution() public {
        // F5: worker dimatikan di tengah jalannya demo; aksi lama tetap bisa dieksekusi
        (bytes32 aid, address to) = _proposeNew(1 ether);

        vault.setWorker(w1, false);

        bytes32 aid2 = _nextAid();
        vm.prank(w1);
        vm.expectRevert("NOT_WORKER");
        vault.proposeAction(aid2, _newRecipient(3), 1 ether, bytes32(0));

        // aksi lama tetap hidup: 3/3 → cair
        _submit(1, aid, false);
        _submit(2, aid, false);
        _submit(3, aid, false);
        vault.executeAction(aid);
        assertEq(to.balance, 1 ether, "aksi lama tetap dihormati");
    }
}
