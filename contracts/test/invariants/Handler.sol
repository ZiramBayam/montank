// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AegisVault} from "../../src/AegisVault.sol";
import {HappyPayee, ReentrantPayee} from "../Mocks.sol";

/// @title Handler invariant AegisVault (pola fuzzed-handler, docs/06 L3).
/// @dev SEMUA mutasi state target hanya boleh lewat fungsi op*() handler di bawah.
///      Handler menyimpan mirror ("ghost state") untuk invariant yang tidak bisa
///      dinyatakan murni dari state on-chain (urutan transisi, konservasi dana).
///
///      Pemetaan invariant (docs/01 B1-B7 + PRD §5):
///      - I1 dara beku PENDING <= saldo vault            -> invariant_frozen_covered
///      - I2 transisi status legal (terminal idempotent) -> ghostStatusViolations
///      - I3 Jalur B cair hanya 3/3 Clear aktif          -> invariant_jalurB_paid_requiresFullClear
///      - I4 suara penjaga imutabel                      -> ghostDecisionViolations
///      - I5 atas jendela                                -> invariant_windowCap_respected
///      - I6 fail-closed VETOED/EXPIRED tak pernah cair  -> invariant_failClosed_propose... (lihat file invariants)
///      - I8 konservasi dana                             -> invariant_conservation
contract Handler is Test {
    // ------------------------------------------------------------------ Target
    AegisVault public target;
    HappyPayee public happyPayee;
    ReentrantPayee public reentPayee;

    // ------------------------------------------------------------------ Actors
    address[3] public guardians;
    address[2] public workers;

    // -------------------------------------------------------------- Ghost state
    bytes32[] internal ghostIds;
    mapping(bytes32 => bool) internal ghostSeen;
    mapping(bytes32 => AegisVault.ActionStatus) internal ghostStatus;
    mapping(bytes32 => uint96) internal ghostAmount;
    mapping(bytes32 => uint64) internal ghostExpire;
    mapping(bytes32 => bool) internal ghostIsB; // Jalur B (expireBlock != 0)
    mapping(bytes32 => bool) internal ghostPaid; // pernah benar-benar cair (EXECUTED)
    mapping(bytes32 => uint8) internal ghostMaskAtPay; // mask berlaku SAAT aksi dibayar (B2: mask bisa berubah)
    mapping(bytes32 => mapping(uint8 => uint8)) internal ghostDecision;

    address[] internal ghostPayees;
    mapping(address => bool) internal ghostPayeeKnown;
    mapping(address => uint96) internal ghostPerWin; // cap jendela ghost (tidak mungkin menyusut)

    uint256 internal ghostFunded;
    uint256 internal ghostPayouts;
    uint256 internal ghostStatusViolations;
    uint256 internal ghostDecisionViolations;

    uint256 internal nonce;

    uint8 internal constant D_NONE = 0;
    uint8 internal constant D_CLEAR = 1;

    constructor() {
        guardians[0] = makeAddr("inv_guardian1");
        guardians[1] = makeAddr("inv_guardian2");
        guardians[2] = makeAddr("inv_guardian3");
        workers[0] = makeAddr("inv_worker1");
        workers[1] = makeAddr("inv_worker2");

        // owner == handler (deployer). Panggilan admin tak perlu prank.
        vm.deal(address(this), 1000 ether);

        address[3] memory gs = [guardians[0], guardians[1], guardians[2]];
        address[] memory ws = new address[](2);
        ws[0] = workers[0];
        ws[1] = workers[1];

        target = new AegisVault{value: 50 ether}(gs, ws, 0x7, 100, 200, false); // 0x7 = 0b111
        ghostFunded = 50 ether;

        happyPayee = new HappyPayee();
        reentPayee = new ReentrantPayee(target);
    }

    // ----------------------------------------------------------------Handlers
    /// @notice Worker mengajukan pembayaran (Jalur A / B / penolakan Layer 0).
    function opPropose(uint256 seed) public {
        uint256 r = seed;
        bytes32 aid = keccak256(abi.encode("inv-aid", nonce++));

        address w = workers[r % 2];

        address to;
        uint256 sel = (r / 2) % 6;
        if (sel == 0) {
            to = address(happyPayee);
        } else if (sel == 1) {
            to = address(reentPayee);
        } else {
            to = address(uint160(0xABCD0000 + uint160(sel))); // kandidat penerima baru (bisa jadi terdaftar via opPayee)
        }

        uint96 amt;
        uint256 amtSel = (r / 2) % 5;
        if (amtSel == 0) {
            amt = 0; // penolakan R_ZERO_AMOUNT
        } else if (amtSel == 4) {
            amt = 6 ether; // > MAX_NEW_RECIPIENT_PAYOUT (5e) -> penolakan R_OVER_TX_CAP
        } else {
            amt = uint96(amtSel) * 0.5 ether; // 0.5 / 1 / 1.5 ether
        }

        vm.prank(w);
        try target.proposeAction(aid, to, amt, bytes32(r)) {} catch {}
        _sync(aid);
    }

    /// @notice Penjaga memberi suara (Clear/Veto); termasuk suara untuk aksi yang
    ///         sudah selesai/reject - memastikan submit idempotent & imutabel.
    function opSubmit(uint256 seed) public {
        if (ghostIds.length == 0) return;

        uint8 gid = uint8((seed % 3) + 1);
        bytes32 aid = ghostIds[seed % ghostIds.length];
        bool veto = (seed % 2) == 0;

        bytes32 key = _decisionKey(aid, gid);
        uint8 before = target.decision(key);

        vm.prank(guardians[gid - 1]);
        try target.submitDecision(aid, veto, uint8((seed / 3) % 4)) {} catch {}

        uint8 after_ = target.decision(key);
        if (before != D_NONE) {
            // suara tercatat tidak boleh berubah (I4)
            if (after_ != before) ghostDecisionViolations++;
        } else if (after_ != D_NONE) {
            ghostDecision[aid][gid] = after_;
        }
    }

    /// @notice Eksekusi oleh actor arbitrer: executor, attacker, worker.
    function opExecute(uint256 seed) public {
        if (ghostIds.length == 0) return;

        bytes32 aid = ghostIds[seed % ghostIds.length];

        address caller = makeAddr("inv_executor");
        uint256 pick = seed % 4;
        if (pick == 1) caller = makeAddr("inv_attacker");
        else if (pick == 2) caller = workers[0];
        else if (pick == 3) caller = workers[1];

        vm.prank(caller);
        try target.executeAction(aid) {} catch {}
        _sync(aid);
    }

    /// @notice Owner mengelola registri payee (cap jendela tidak pernah menyusut).
    function opPayee(uint256 seed) public {
        address payee;
        uint256 sel = seed % 4;
        if (sel == 0) {
            payee = address(happyPayee);
        } else if (sel == 1) {
            payee = address(reentPayee);
        } else {
            payee = address(uint160(0xABCD0000 + uint160((seed / 4) % 5)));
        }

        uint96 perTx = uint96(((seed / 4) % 5) * 1 ether + 1 ether); // 1..5 ether
        uint96 wanted = uint96(((seed / 2) % 5) * 1 ether + 2 ether); // 2..6 ether

        // Cap jendela dipaksa monoton naik (owner dipercaya; penyusutan cap adalah
        // kekuatan admin yang terdokumentasi di audit manual, bukan bug Layer 0)
        uint96 perWin = wanted < ghostPerWin[payee] ? ghostPerWin[payee] : wanted;

        ghostPerWin[payee] = perWin;
        if (!ghostPayeeKnown[payee]) {
            ghostPayeeKnown[payee] = true;
            ghostPayees.push(payee);
        }

        try target.registerPayee(payee, perTx, perWin) {} catch {}
    }

    /// @notice Siapa pun menambah dana brankas.
    function opFund(uint256 seed) public {
        address funder = (seed % 2 == 0) ? makeAddr("inv_executor") : makeAddr("inv_attacker");
        uint256 amt = ((seed / 2) % 3 + 1) * 1 ether;

        vm.deal(funder, amt);
        vm.prank(funder);
        (bool ok,) = address(target).call{value: amt}("");
        if (ok) ghostFunded += amt;
    }

    /// @notice Memajukan waktu (blok) - memicu expire & reset jendela.
    function opRoll(uint256 seed) public {
        vm.roll(block.number + uint256((seed % 250) + 1));
    }

    /// @notice Owner mengubah mask governance (docs/01 B2: P0 = 0b001 -> P1 = 0b111 tanpa redeploy).
    function opSetMask(uint256 seed) public {
        uint8 newMask = uint8((seed % 7) + 1); // 1..7 semua nilai sah
        try target.setGuardianMask(newMask) {} catch {}
    }

    /// @notice Owner mengaktifkan/menonaktifkan worker.
    function opSetWorker(uint256 seed) public {
        address w = workers[seed % 2];
        bool active = (seed / 2) % 2 == 0;
        try target.setWorker(w, active) {} catch {}
    }

    // ------------------------------------------------------------------- Ghost
    function _decisionKey(bytes32 aid, uint8 gid) internal pure returns (bytes32) {
        return keccak256(abi.encode(aid, gid));
    }

    function _isLegalTransition(AegisVault.ActionStatus prev, AegisVault.ActionStatus next) internal pure returns (bool) {
        if (prev == AegisVault.ActionStatus.NONE) {
            return next == AegisVault.ActionStatus.NONE
                || next == AegisVault.ActionStatus.PENDING
                || next == AegisVault.ActionStatus.EXECUTED
                || next == AegisVault.ActionStatus.PAYOUT_FAILED;
        }
        if (prev == AegisVault.ActionStatus.PENDING) {
            return next == AegisVault.ActionStatus.PENDING
                || next == AegisVault.ActionStatus.VETOED
                || next == AegisVault.ActionStatus.EXECUTED
                || next == AegisVault.ActionStatus.EXPIRED
                || next == AegisVault.ActionStatus.PAYOUT_FAILED;
        }
        if (prev == AegisVault.ActionStatus.EXECUTED) {
            return next == AegisVault.ActionStatus.EXECUTED
                || next == AegisVault.ActionStatus.PAYOUT_FAILED;
        }
        // VETOED / EXPIRED / PAYOUT_FAILED terminal - tidak pernah keluar dari sana
        return next == prev;
    }

    function _sync(bytes32 aid) internal {
        (, uint96 amt,, uint64 eb, AegisVault.ActionStatus st,) = target.actions(aid);

        if (!ghostSeen[aid]) {
            ghostSeen[aid] = true;
            ghostIds.push(aid);
            ghostIsB[aid] = (eb != 0);
            ghostAmount[aid] = amt;
            ghostStatus[aid] = st;
            if (st == AegisVault.ActionStatus.EXECUTED) {
                ghostPaid[aid] = true;
                ghostMaskAtPay[aid] = uint8(target.actionGuardianMask(aid));
                ghostPayouts += amt;
            }
            return;
        }

        AegisVault.ActionStatus prev = ghostStatus[aid];
        if (!_isLegalTransition(prev, st)) {
            ghostStatusViolations++;
        }
        if (st == AegisVault.ActionStatus.EXECUTED && !ghostPaid[aid]) {
            ghostPaid[aid] = true;
            ghostMaskAtPay[aid] = uint8(target.actionGuardianMask(aid));
            ghostPayouts += ghostAmount[aid];
        }
        ghostStatus[aid] = st;
    }

    // ------------------------------------------------------- Getter ghost (untuk invariant)
    function ghostIdList() external view returns (bytes32[] memory) {
        return ghostIds;
    }

    function ghostStatusOf(bytes32 aid) external view returns (uint8) {
        return uint8(ghostStatus[aid]);
    }

    function ghostAmountOf(bytes32 aid) external view returns (uint96) {
        return ghostAmount[aid];
    }

    function ghostIsBOf(bytes32 aid) external view returns (bool) {
        return ghostIsB[aid];
    }

    function ghostPaidOf(bytes32 aid) external view returns (bool) {
        return ghostPaid[aid];
    }

    function ghostMaskAtPayOf(bytes32 aid) external view returns (uint8) {
        return ghostMaskAtPay[aid];
    }

    function ghostDecisionAt(bytes32 aid, uint8 gid) external view returns (uint8) {
        return ghostDecision[aid][gid];
    }

    function ghostPayeeList() external view returns (address[] memory) {
        return ghostPayees;
    }

    function ghostFundedTotal() external view returns (uint256) {
        return ghostFunded;
    }

    function ghostTotalPayouts() external view returns (uint256) {
        return ghostPayouts;
    }

    function ghostStatusViolationCount() external view returns (uint256) {
        return ghostStatusViolations;
    }

    function ghostDecisionViolationCount() external view returns (uint256) {
        return ghostDecisionViolations;
    }
}
