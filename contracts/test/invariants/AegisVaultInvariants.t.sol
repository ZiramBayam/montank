// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {StdInvariant} from "forge-std/StdInvariant.sol";
import {Test} from "forge-std/Test.sol";
import {AegisVault} from "../../src/AegisVault.sol";
import {Handler} from "./Handler.sol";

/// @title Invariant suite AegisVault (lapisan audit L3, docs/06).
/// @dev Invariant dijalankan setiap sekuens panggilan handler acak
///      (foundry.toml: invariant.runs/depth). I6 & I7 sebagian besar tertutup unit test
///      (B5/B8 & D8/D9/D10); I6 terbukti juga di sini dalam bentuk "EXPIRED tak pernah cair".
contract AegisVaultInvariants is StdInvariant, Test {
    Handler internal handler;
    AegisVault internal vault;

    uint8 internal constant ST_VETOED = 2;
    uint8 internal constant ST_EXECUTED = 3;
    uint8 internal constant ST_EXPIRED = 4;
    uint8 internal constant D_NONE = 0;
    uint8 internal constant D_CLEAR = 1;

    function setUp() public {
        handler = new Handler();
        vault = handler.target();
        targetContract(address(handler));
    }

    /// (I1) Konservasi EKSAK: saldo vault == dana masuk - payout tercatat.
    ///      Selalu benar (tidak ada inflow/outflow lain). Versi lama
    ///      "total PENDING <= saldo" adalah over-claim yang dikoreksi hasil audit
    ///      kedua: frozen LEGITIM bisa melebihi saldo dan beres `PAYOUT_FAILED`
    ///      fail-soft (unit probe `FreshAuditProbe.test_frozenOverBalance_resolvesSoftly`).
    function invariant_conservationExact() public view {
        assertEq(
            address(vault).balance,
            handler.ghostFundedTotal() - handler.ghostTotalPayouts(),
            "I1: saldo != dana masuk - payout"
        );
    }

    /// (I2) Transisi status selalu legal; terminal state idempotent.
    function invariant_statusTransitions_legal() public view {
        assertEq(handler.ghostStatusViolationCount(), 0, "I2: transisi ilegal");
    }

    /// (I3) Jalur B hanya bisa terbayar ketika SEMUA penjaga pada snapshot proposal
    ///      memberi suara Clear.
    function invariant_jalurB_paid_requiresFullClear() public view {
        bytes32[] memory ids = handler.ghostIdList();

        for (uint256 i = 0; i < ids.length; ++i) {
            bytes32 aid = ids[i];
            if (!handler.ghostIsBOf(aid)) continue;
            if (handler.ghostStatusOf(aid) != ST_EXECUTED) continue; // PAYOUT_FAILED = tidak benar-benar cair

            uint8 mask = handler.ghostMaskAtPayOf(aid);
            uint8 active = 0;
            uint8 clears = 0;
            for (uint8 g = 1; g <= 3; ++g) {
                if ((mask & uint8(1 << (g - 1))) == 0) continue;
                ++active;
                if (handler.ghostDecisionAt(aid, g) == D_CLEAR) ++clears;
            }
            assertEq(clears, active, "I3: Jalur B terbayar tanpa quorum Clear penuh");
        }
    }

    /// (I3 turunan/B2) Mask governance selalu valid (1..0b111) pada saat apapun.
    function invariant_maskValid() public view {
        uint8 m = vault.guardianMask();
        assertTrue(m != 0 && m <= 0x7, "mask di luar 1..0b111");
    }

    /// (I4) Suara penjaga yang sudah tercatat tidak pernah berubah (first-vote-final).
    function invariant_decisionImmutable() public view {
        assertEq(handler.ghostDecisionViolationCount(), 0, "I4: slot keputusan berubah");
    }

    /// (I5) Akumulasi dalam jendela tidak pernah melebihi cap jendela.
    function invariant_windowCap_respected() public view {
        address[] memory ps = handler.ghostPayeeList();
        for (uint256 i = 0; i < ps.length; ++i) {
            (, , uint96 perWin, uint96 spent,) = vault.payees(ps[i]);
            assertLe(spent, perWin, "I5: cap jendela dilanggar");
        }
    }

    /// (I6) Fail-closed: aksi VETOED / EXPIRED tidak pernah benar-benar cair.
    function invariant_failClosed_neverPaid() public view {
        bytes32[] memory ids = handler.ghostIdList();
        for (uint256 i = 0; i < ids.length; ++i) {
            bytes32 aid = ids[i];
            uint8 st = handler.ghostStatusOf(aid);
            if (st == ST_VETOED || st == ST_EXPIRED) {
                assertFalse(handler.ghostPaidOf(aid), "I6: VETOED/EXPIRED terbayar");
            }
        }
    }

    /// (I8) Total payout < = total dana masuk (konservasi ETH).
    function invariant_conservation() public view {
        assertLe(handler.ghostTotalPayouts(), handler.ghostFundedTotal(), "I8: kuran lebih besar dari dana");
    }

    /// (I2/I3 turunan) Aksi terbayar hanya status EXECUTED; tidak pernah kembali.
    function invariant_paidImpliesExecuted() public view {
        bytes32[] memory ids = handler.ghostIdList();
        for (uint256 i = 0; i < ids.length; ++i) {
            if (handler.ghostPaidOf(ids[i])) {
                assertEq(handler.ghostStatusOf(ids[i]), ST_EXECUTED, "paid flag pada status bukan EXECUTED");
            }
        }
    }
}
