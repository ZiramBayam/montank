// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AegisVault} from "../src/AegisVault.sol";

// --------------------------------------------------------------------- Mock payee
/// @notice Payee ramah: menerima MON tanpa drama.
contract HappyPayee {
    receive() external payable {}
}

/// @notice Payee yang selalu revert di `receive()`.
contract RevertingPayee {
    receive() external payable {
        revert("no");
    }
}

/// @notice Payee yang membakar seluruh gas yang diberikan (invalid()).
contract GasBurnerPayee {
    receive() external payable {
        assembly {
            invalid()
        }
    }
}

/// @notice Payee reentrant: mencoba masuk kembali ke `executeAction` / `proposeAction`
///         saat dibayar. Harus diblok guard + CEI (docs/03 C4/C5, F1/F4).
contract ReentrantPayee {
    enum Mode {
        None,
        Reexecute,
        Repropose
    }

    AegisVault public immutable vault;
    Mode public mode;
    bytes32 public reAid;
    address public reTo;
    uint96 public reAmt;

    uint256 public tries;

    constructor(AegisVault vault_) {
        vault = vault_;
    }

    /// @notice Konfigurasi serangan reentrancy sebelum payee dijadikan tujuan pembayaran.
    ///         Mode Repropose dipakai saat payee JALUR A (proposeAction yang membayar);
    ///         attack aid HARUS berbeda dari aid terakhir agar tidak bentrok duplicate-id.
    function setAttack(Mode mode_, bytes32 aid_, address to_, uint96 amt_) external {
        mode = mode_;
        reAid = aid_;
        reTo = to_;
        reAmt = amt_;
    }

    function reset() external {
        mode = Mode.None;
        tries = 0;
    }

    receive() external payable {
        tries++;
        if (mode == Mode.Reexecute) {
            vault.executeAction(reAid);
        } else if (mode == Mode.Repropose) {
            vault.proposeAction(reAid, reTo, reAmt, bytes32(0));
        }
    }
}
