// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "./vendor/ReentrancyGuard.sol";

/// @title AegisVault - brankas on-chain untuk agen AI otonom (Monad Blitz demo).
/// @notice Dua jalur pembayaran; deploy resmi mengunci Jalur B ke klaim berbukti satu-kali:
///         - Jalur A (penerima terdaftar): cair instan di dalam tx `proposeAction`,
///           pelindung Layer 0 (batas per-tx + batas kumulatif per jendela, tanpa revert).
///         - Jalur B (penerima baru): klaim mengikat penerima/nominal/expiry/evidence hash,
///           lalu `PENDING` → cair hanya jika semua penjaga dalam snapshot memberi Clear;
///           1 Veto menahan.
///           Bukti sumber diverifikasi backend, bukan kontrak.
/// @dev Aturan Monad (PRD §3.3): penagihan gas `gas_limit × gas_price` dan revert membakar
///      seluruh gas_limit → semua jalur "gagal normal" HARUS `return` (no-op), bukan revert.
///      Satu-satunya require yang reversi = pemanggil tak sah (NOT_WORKER / NOT_GUARDIAN / NOT_OWNER).
///      Larangan slot panas (PRD §3.4): keputusan penjaga disimpan satu slot per (actionId, guardianId);
///      `actionId` dibuat server; tidak ada counter global; totalSaved dihitung dari event oleh indexer.
contract AegisVault is ReentrancyGuard {
    // ---------------------------------------------------------------- Types
    enum ActionStatus { NONE, PENDING, VETOED, EXECUTED, EXPIRED, PAYOUT_FAILED }

    // Keputusan per penjaga - satu slot per (actionId, guardianId)
    uint8 internal constant D_NONE = 0;
    uint8 internal constant D_CLEAR = 1;
    uint8 internal constant D_VETO = 2;

    // Alasan penolakan Layer 0 (dicatat via event, TANPA revert)
    uint8 internal constant R_ZERO_ADDR = 1;
    uint8 internal constant R_ZERO_AMOUNT = 2;
    uint8 internal constant R_OVER_TX_CAP = 3;
    uint8 internal constant R_OVER_WINDOW_CAP = 4;
    uint8 internal constant R_ZERO_ACTION_ID = 5;
    uint8 internal constant R_CLAIM_MISSING = 1;
    uint8 internal constant R_CLAIM_MISMATCH = 2;
    uint8 internal constant R_CLAIM_EXPIRED = 3;
    uint8 internal constant R_CLAIM_BUSY = 4;

    struct ProposedAction {
        address proposer; // EOA Worker
        uint96 amount;
        address to;
        uint64 expireBlock; // 0 untuk Jalur A (bayar instan)
        ActionStatus status;
        bytes32 intentHash;
    }

    struct Payee {
        bool registered;
        uint96 perTxCap;
        uint96 perWindowCap;
        uint96 spentInWindow;
        uint64 windowStartBlock;
    }

    struct Claim {
        address recipient;
        uint96 amount;
        uint64 validUntilBlock;
        bytes32 evidenceHash;
        bytes32 activeActionId;
        bool used;
        bool cancelled;
    }

    // ---------------------------------------------------------- Constants
    uint96 public constant MAX_NEW_RECIPIENT_PAYOUT = 5 ether; // Layer 0, Jalur B
    uint256 internal constant PAYOUT_GAS_CAP = 50_000; // gas panggilan ke penerima
    uint8 internal constant MAX_GUARDIANS = 3;

    // --------------------------------------------------------- Config (immutable; docs/01 B2/B3)
    /// @dev timeout aksi PENDING - nilai provisional saat deploy spike, final pasca-spike (docs/02 §4)
    uint64 public immutable expiryBlocks;
    /// @dev jendela kumulatif Jalur A (reset-on-expiry per payee)
    uint64 public immutable windowBlocks;
    /// @dev 0b001..0b111. Mask hanya boleh ditambah; proposal menyimpan snapshot-nya.
    uint8 public guardianMask;
    /// @dev Jalur B claim-bound; immutable supaya mode keamanan tidak bisa dimatikan.
    bool public immutable claimMode;

    // -------------------------------------------------------------- State
    mapping(bytes32 => ProposedAction) public actions; // actionId dibuat SERVER
    mapping(bytes32 => uint8) public decision; // key = keccak256(abi.encode(actionId, guardianId))
    /// @dev Snapshot quorum policy per pending action. Policy changes affect new proposals only.
    mapping(bytes32 => uint8) public actionGuardianMask;
    mapping(address => Payee) public payees; // registri penerima terdaftar (Jalur A)
    mapping(address => uint8) public guardianIndex; // 1..3 (0 = bukan penjaga)
    mapping(address => bool) public isAgentWorker;
    mapping(bytes32 => Claim) public claims;
    /// @dev Immutable (slither immutable-states): B6 = owner tetap tanpa transfer.
    address public immutable owner;

    // ------------------------------------------------------------- Events
    event ActionProposed(bytes32 indexed actionId, address indexed to, uint256 amount, uint64 expireBlock, bytes32 intentHash);
    event Layer0Rejected(bytes32 indexed actionId, address indexed to, uint256 amount, uint8 reasonCode);
    event GuardianDecision(bytes32 indexed actionId, uint8 indexed guardianId, bool isVeto, uint8 reasonCode);
    event ActionResolved(bytes32 indexed actionId, ActionStatus status, uint256 amount);
    event PayeeRegistered(address indexed payee, uint96 perTxCap, uint96 perWindowCap);
    event WorkerSet(address indexed worker, bool active);
    event GuardianMaskChanged(uint8 oldMask, uint8 newMask);
    event ClaimRegistered(bytes32 indexed claimId, address indexed recipient, uint96 amount, uint64 validUntilBlock, bytes32 evidenceHash);
    event ClaimCancelled(bytes32 indexed claimId);
    event ClaimRejected(bytes32 indexed actionId, bytes32 indexed claimId, uint8 reasonCode);
    event ClaimReserved(bytes32 indexed claimId, bytes32 indexed actionId);
    event ClaimUsed(bytes32 indexed claimId, bytes32 indexed actionId);

    // ---------------------------------------------------------- Constructor
    constructor(
        address[MAX_GUARDIANS] memory guardians_,
        address[] memory workers_,
        uint8 guardianMask_,
        uint64 expiryBlocks_,
        uint64 windowBlocks_,
        bool claimMode_
    ) payable {
        require(guardianMask_ != 0 && guardianMask_ <= 0x7, "BAD_MASK"); // 0x7 = 0b111 - docs/01 B2
        require(expiryBlocks_ != 0 && expiryBlocks_ <= 1e9, "BAD_EXPIRY");
        require(windowBlocks_ != 0 && windowBlocks_ <= 1e9, "BAD_WINDOW");
        require(guardians_[0] != address(0), "ZERO_GUARDIAN");
        require(guardians_[1] != address(0), "ZERO_GUARDIAN");
        require(guardians_[2] != address(0), "ZERO_GUARDIAN");
        require(guardians_[0] != guardians_[1], "DUP_GUARDIAN");
        require(guardians_[1] != guardians_[2], "DUP_GUARDIAN");
        require(guardians_[0] != guardians_[2], "DUP_GUARDIAN");
        require(guardians_[0] != msg.sender, "ROLE_CONFLICT");
        require(guardians_[1] != msg.sender, "ROLE_CONFLICT");
        require(guardians_[2] != msg.sender, "ROLE_CONFLICT");

        guardianIndex[guardians_[0]] = 1;
        guardianIndex[guardians_[1]] = 2;
        guardianIndex[guardians_[2]] = 3;

        for (uint256 i = 0; i < workers_.length; ++i) {
            require(workers_[i] != address(0), "ZERO_WORKER");
            require(workers_[i] != msg.sender && guardianIndex[workers_[i]] == 0, "ROLE_CONFLICT");
            isAgentWorker[workers_[i]] = true;
        }

        expiryBlocks = expiryBlocks_;
        windowBlocks = windowBlocks_;
        guardianMask = guardianMask_;
        claimMode = claimMode_;
        owner = msg.sender;
        // ReentrancyGuard constructor turunannya: guard diset NOT_ENTERED (OZ v5.7, varian SSTORE)
    }

    // ------------------------------------------------- Jalur utama pembayaran
    /// @notice EOA Worker mengajukan pembayaran atas nama agen.
    ///         Jalur A (penerima terdaftar) → bayar instan jika lolos Layer 0.
    ///         Jalur B (penerima baru)     → simpan PENDING, tunggu semua Clear sesuai snapshot.
    function proposeAction(bytes32 actionId, address to, uint96 amount, bytes32 intentHash) external nonReentrant {
        require(isAgentWorker[msg.sender], "NOT_WORKER");

        // Zero is the sentinel for an unreserved claim; action IDs must be nonzero.
        if (actionId == bytes32(0)) {
            emit Layer0Rejected(actionId, to, amount, R_ZERO_ACTION_ID);
            return;
        }

        // ID duplikat = no-op (actionId dari server; yang pertama menang)
        if (actions[actionId].status != ActionStatus.NONE) return;

        // Layer 0 - penolakan dicatat via event, TANPA revert
        if (to == address(0)) {
            emit Layer0Rejected(actionId, to, amount, R_ZERO_ADDR);
            return;
        }
        if (amount == 0) {
            emit Layer0Rejected(actionId, to, amount, R_ZERO_AMOUNT);
            return;
        }

        Payee storage p = payees[to];
        if (p.registered) {
            // ---- Jalur A: penerima terdaftar ----
            // Jendela kumulatif: reset-on-expiry (bukan bergeser per transaksi)
            if (uint256(block.number) >= uint256(p.windowStartBlock) + windowBlocks) {
                p.windowStartBlock = uint64(block.number);
                p.spentInWindow = 0;
            }
            if (amount > p.perTxCap) {
                emit Layer0Rejected(actionId, to, amount, R_OVER_TX_CAP);
                return;
            }
            // Batas kumulatif per jendela
            // (ini yang menangkap split-drain ke penerima terdaftar)
            if (uint256(p.spentInWindow) + amount > p.perWindowCap) {
                emit Layer0Rejected(actionId, to, amount, R_OVER_WINDOW_CAP);
                return;
            }
            // CEI: efek dulu (akumulasi + status EXECUTED), interaksi kemudian
            p.spentInWindow += amount;
            actions[actionId] = ProposedAction({
                proposer: msg.sender,
                amount: amount,
                to: to,
                expireBlock: 0,
                status: ActionStatus.EXECUTED,
                intentHash: intentHash
            });
            emit ActionProposed(actionId, to, amount, 0, intentHash);
            _pay(actionId, to, amount);
        } else {
            // ---- Jalur B: penerima baru ----
            if (amount > MAX_NEW_RECIPIENT_PAYOUT) {
                emit Layer0Rejected(actionId, to, amount, R_OVER_TX_CAP);
                return;
            }

            if (claimMode) {
                Claim storage c = claims[intentHash];
                if (intentHash == bytes32(0) || c.recipient == address(0)) {
                    emit ClaimRejected(actionId, intentHash, R_CLAIM_MISSING);
                    return;
                }
                if (c.recipient != to || c.amount != amount) {
                    emit ClaimRejected(actionId, intentHash, R_CLAIM_MISMATCH);
                    return;
                }
                if (c.cancelled || block.number > c.validUntilBlock) {
                    emit ClaimRejected(actionId, intentHash, R_CLAIM_EXPIRED);
                    return;
                }
                if (c.used || c.activeActionId != bytes32(0)) {
                    emit ClaimRejected(actionId, intentHash, R_CLAIM_BUSY);
                    return;
                }
                c.activeActionId = actionId;
                emit ClaimReserved(intentHash, actionId);
            }

            uint64 expire = uint64(block.number) + expiryBlocks;
            if (claimMode && claims[intentHash].validUntilBlock < expire) {
                expire = claims[intentHash].validUntilBlock;
            }
            actions[actionId] = ProposedAction({
                proposer: msg.sender,
                amount: amount,
                to: to,
                expireBlock: expire,
                status: ActionStatus.PENDING,
                intentHash: intentHash
            });
            actionGuardianMask[actionId] = guardianMask;
            // Tidak ada pembayaran di sini - dana ditahan sampai quorum.
            emit ActionProposed(actionId, to, amount, expire, intentHash);
        }
    }

    /// @notice HANYA MENCATAT, idempotent. Hanya proposal PENDING sebelum deadline dan penjaga dalam
    ///         snapshot mask-nya yang boleh mengisi slot; suara pertama final.
    ///         Tiga penjaga mengirim pada blok yang sama: tiga slot berbeda, tidak saling revert.
    function submitDecision(bytes32 actionId, bool isVeto, uint8 reasonCode) external {
        uint8 gid = guardianIndex[msg.sender];
        require(gid != 0, "NOT_GUARDIAN");

        // Votes bind to an already-recorded action and to the guardian set that
        // was active when it was proposed. No pre-votes or retroactive approvals.
        ProposedAction storage a = actions[actionId];
        if (a.status != ActionStatus.PENDING || block.number >= a.expireBlock) return;
        uint8 mask = actionGuardianMask[actionId];
        if (mask & (uint8(1) << (gid - 1)) == 0) return;

        bytes32 k = _decisionKey(actionId, gid);
        if (decision[k] != D_NONE) return; // suara pertama final; tidak bisa diubah/ditarik

        decision[k] = isVeto ? D_VETO : D_CLEAR;
        emit GuardianDecision(actionId, gid, isVeto, reasonCode);
    }

    /// @notice Siapa pun boleh memanggil (kontrak tidak bergantung pada executor kita).
    ///         Prioritas: Veto menahan → semua Clear sesuai snapshot membayar (fast path menang atas expire)
    ///         → belum bulat + lewat expire → EXPIRED (fail-closed: dana tidak pernah keluar).
    function executeAction(bytes32 actionId) external nonReentrant {
        ProposedAction storage a = actions[actionId];
        if (a.status != ActionStatus.PENDING) return;

        uint8 mask = actionGuardianMask[actionId];
        bool hasVeto = false;
        bool complete = true;
        bool anyActive = false;

        for (uint8 i = 1; i <= MAX_GUARDIANS; ++i) {
            if (mask & (uint8(1) << (i - 1)) == 0) continue; // penjaga di luar mask tidak dihitung
            anyActive = true;
            uint8 d = decision[_decisionKey(actionId, i)];
            if (d == D_VETO) {
                hasVeto = true;
            } else if (d == D_NONE) {
                complete = false;
            }
        }

        if (hasVeto) {
            // Satu Veto menahan - tidak mungkin dibatalkan faktor lain
            a.status = ActionStatus.VETOED;
            _releaseClaim(a, actionId);
            emit ActionResolved(actionId, ActionStatus.VETOED, a.amount);
            return;
        }
        if (claimMode && block.number > claims[a.intentHash].validUntilBlock) {
            a.status = ActionStatus.EXPIRED;
            _releaseClaim(a, actionId);
            emit ActionResolved(actionId, ActionStatus.EXPIRED, a.amount);
            return;
        }
        if (complete) {
            // 3/3 Clear → fast path: TIDAK menunggu jendela; menang bahkan jika
            // eksekusi dilakukan setelah blok expire (putusan lengkap tetap cair)
            a.status = ActionStatus.EXECUTED;
            _pay(actionId, a.to, a.amount);
            return;
        }
        if (!anyActive || block.number >= a.expireBlock) {
            // Fail-closed (docs/01 B1): penjaga yang diam tidak pernah mencairkan dana.
            // Agent boleh mengajukan ulang dengan actionId baru.
            a.status = ActionStatus.EXPIRED;
            _releaseClaim(a, actionId);
            emit ActionResolved(actionId, ActionStatus.EXPIRED, a.amount);
        }
        // else: quorum belum bulat dan belum expire → tetap PENDING (no-op)
    }

    // ------------------------------------------------------------- Internal
    /// @dev Status HARUS sudah diset sebelum panggilan (CEI). Gagal pembayaran hanya
    ///      menandai status, TIDAK pernah revert ke pemanggil.
    function _pay(bytes32 actionId, address to, uint96 amount) internal {
        ProposedAction storage a = actions[actionId];
        Claim storage c = claims[a.intentHash];
        bool reservedClaim = claimMode && c.activeActionId == actionId;

        if (address(this).balance < amount) {
            a.status = ActionStatus.PAYOUT_FAILED;
            if (reservedClaim) c.activeActionId = bytes32(0);
            emit ActionResolved(actionId, ActionStatus.PAYOUT_FAILED, amount);
            return;
        }
        if (reservedClaim) {
            c.activeActionId = bytes32(0);
            c.used = true;
        }
        // Panggilan low-level tanpa decode (anti return-bomb, slither): returndata TIDAK
        // di-copy ke memori pemanggil, sehingga penerima buruk tidak bisa memuakkan
        // tx pembayar dengan mengembalikan data raksasa. Gas dalam tetap dipotong cap.
        bool ok;
        assembly {
            ok := call(PAYOUT_GAS_CAP, to, amount, 0, 0, 0, 0)
        }
        if (!ok) {
            // Penerima kontrak jahat (revert / out-of-gas) tidak bisa mengganggu tx siapa pun
            a.status = ActionStatus.PAYOUT_FAILED;
            if (reservedClaim) c.used = false;
            emit ActionResolved(actionId, ActionStatus.PAYOUT_FAILED, amount);
        } else {
            if (reservedClaim) emit ClaimUsed(a.intentHash, actionId);
            emit ActionResolved(actionId, ActionStatus.EXECUTED, amount);
        }
        // ok == true → selesai; status sukses ikut dicatat lewat ActionResolved.
    }

    function _decisionKey(bytes32 actionId, uint8 gid) internal pure returns (bytes32) {
        return keccak256(abi.encode(actionId, gid));
    }

    function _releaseClaim(ProposedAction storage a, bytes32 actionId) internal {
        if (!claimMode) return;
        Claim storage c = claims[a.intentHash];
        if (c.activeActionId != actionId) return;
        c.activeActionId = bytes32(0);
    }

    /// @notice Anchor an approved task/claim to one exact recipient and amount.
    /// @dev evidenceHash commits to the off-chain source record; guards still verify that source.
    function registerClaim(
        bytes32 claimId,
        address recipient,
        uint96 amount,
        uint64 validUntilBlock,
        bytes32 evidenceHash
    ) external onlyOwner {
        require(claimId != bytes32(0), "ZERO_CLAIM");
        require(recipient != address(0) && amount != 0, "BAD_CLAIM");
        require(validUntilBlock > block.number && evidenceHash != bytes32(0), "BAD_CLAIM_PROOF");
        require(claims[claimId].recipient == address(0), "CLAIM_EXISTS");

        claims[claimId] = Claim({
            recipient: recipient,
            amount: amount,
            validUntilBlock: validUntilBlock,
            evidenceHash: evidenceHash,
            activeActionId: bytes32(0),
            used: false,
            cancelled: false
        });
        emit ClaimRegistered(claimId, recipient, amount, validUntilBlock, evidenceHash);
    }

    function cancelClaim(bytes32 claimId) external onlyOwner {
        Claim storage c = claims[claimId];
        require(c.recipient != address(0), "CLAIM_MISSING");
        require(!c.used && c.activeActionId == bytes32(0), "CLAIM_IN_USE");
        if (c.cancelled) return;
        c.cancelled = true;
        emit ClaimCancelled(claimId);
    }

    // ----------------------------------------------------------- Admin (docs/01 B6 - minimal)
    /// @notice Upsert: daftar payee baru ATAU update cap; TIDAK me-reset akumulasi jendela.
    function registerPayee(address payeeAddr, uint96 perTxCap, uint96 perWindowCap) external onlyOwner {
        require(payeeAddr != address(0), "ZERO_PAYEE");

        Payee storage p = payees[payeeAddr];
        if (!p.registered) {
            p.registered = true;
            p.windowStartBlock = uint64(block.number);
            p.spentInWindow = 0;
        }
        p.perTxCap = perTxCap;
        p.perWindowCap = perWindowCap;
        emit PayeeRegistered(payeeAddr, perTxCap, perWindowCap);
    }

    /// @notice Rotasi worker EOA saat demo (worker utama biasanya cukup di constructor).
    function setWorker(address workerAddr, bool active) external onlyOwner {
        require(workerAddr != address(0), "ZERO_WORKER");
        if (active) require(workerAddr != owner && guardianIndex[workerAddr] == 0, "ROLE_CONFLICT");

        isAgentWorker[workerAddr] = active;
        emit WorkerSet(workerAddr, active);
    }

    /// @notice Quorum hanya bisa diperketat; perubahan berlaku untuk proposal baru.
    function setGuardianMask(uint8 newMask) external onlyOwner {
        require(newMask != 0 && newMask <= 0x7, "BAD_MASK"); // 0x7 = 0b111
        require((newMask & guardianMask) == guardianMask, "MASK_CANNOT_DECREASE");

        emit GuardianMaskChanged(guardianMask, newMask);
        guardianMask = newMask;
    }

    /// @notice Dana brankas demo masuk di sini.
    receive() external payable {}

    // ------------------------------------------------------------ Modifier
    modifier onlyOwner() {
        require(msg.sender == owner, "NOT_OWNER");
        _;
    }
}
