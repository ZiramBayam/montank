// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Demo vault with a zero-latency registered-payee path and a
///         fail-closed guardian path for new recipients.
contract AegisVault {
    enum ActionStatus { NONE, PENDING, VETOED, EXECUTED, EXPIRED, PAYOUT_FAILED }

    uint8 internal constant D_NONE = 0;
    uint8 internal constant D_CLEAR = 1;
    uint8 internal constant D_VETO = 2;
    uint8 internal constant R_ZERO_ADDR = 1;
    uint8 internal constant R_ZERO_AMOUNT = 2;
    uint8 internal constant R_OVER_TX_CAP = 3;
    uint8 internal constant R_OVER_WINDOW_CAP = 4;

    struct ProposedAction {
        address proposer;
        uint96 amount;
        address to;
        uint64 expireBlock;
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

    uint96 public constant MAX_NEW_RECIPIENT_PAYOUT = 5 ether;
    uint64 public constant WINDOW_BLOCKS = 200;
    uint256 internal constant PAYOUT_GAS_CAP = 50_000;

    address public immutable owner;
    uint64 public immutable expiryBlocks;
    uint8 public immutable guardianMask;

    mapping(bytes32 => ProposedAction) public actions;
    mapping(bytes32 => uint8) public decision;
    mapping(address => Payee) public payees;
    mapping(address => uint8) public guardianIndex;
    mapping(address => bool) public isAgentWorker;

    event ActionProposed(bytes32 indexed actionId, address indexed to, uint256 amount, uint64 expireBlock, bytes32 intentHash);
    event Layer0Rejected(bytes32 indexed actionId, address indexed to, uint256 amount, uint8 reasonCode);
    event GuardianDecision(bytes32 indexed actionId, uint8 indexed guardianId, bool isVeto, uint8 reasonCode);
    event ActionResolved(bytes32 indexed actionId, ActionStatus status, uint256 amount);
    event PayeeUpdated(address indexed payee, bool registered, uint96 perTxCap, uint96 perWindowCap);
    event WorkerUpdated(address indexed worker, bool enabled);

    modifier onlyOwner() {
        require(msg.sender == owner, "NOT_OWNER");
        _;
    }

    constructor(address[3] memory guardians, address[] memory workers, uint8 guardianMask_, uint64 expiryBlocks_) {
        require(guardianMask_ == 1 || guardianMask_ == 7, "INVALID_GUARDIAN_MASK");
        require(expiryBlocks_ > 0, "INVALID_EXPIRY");
        owner = msg.sender;
        guardianMask = guardianMask_;
        expiryBlocks = expiryBlocks_;
        for (uint8 i = 0; i < 3; i++) {
            if ((guardianMask_ & (uint8(1) << i)) == 0) continue;
            require(guardians[i] != address(0), "ZERO_GUARDIAN");
            require(guardianIndex[guardians[i]] == 0, "DUPLICATE_GUARDIAN");
            guardianIndex[guardians[i]] = i + 1;
        }
        for (uint256 i = 0; i < workers.length; i++) {
            require(workers[i] != address(0), "ZERO_WORKER");
            isAgentWorker[workers[i]] = true;
            emit WorkerUpdated(workers[i], true);
        }
    }

    receive() external payable {}

    function registerPayee(address payee, uint96 perTxCap, uint96 perWindowCap) external onlyOwner {
        require(payee != address(0), "ZERO_PAYEE");
        require(perTxCap > 0 && perWindowCap >= perTxCap, "INVALID_CAP");
        payees[payee] = Payee(true, perTxCap, perWindowCap, 0, uint64(block.number));
        emit PayeeUpdated(payee, true, perTxCap, perWindowCap);
    }

    function removePayee(address payee) external onlyOwner {
        Payee storage payeeInfo = payees[payee];
        payeeInfo.registered = false;
        emit PayeeUpdated(payee, false, payeeInfo.perTxCap, payeeInfo.perWindowCap);
    }

    function setWorker(address worker, bool enabled) external onlyOwner {
        require(worker != address(0), "ZERO_WORKER");
        isAgentWorker[worker] = enabled;
        emit WorkerUpdated(worker, enabled);
    }

    function proposeAction(bytes32 actionId, address to, uint96 amount, bytes32 intentHash) external {
        require(isAgentWorker[msg.sender], "NOT_WORKER");
        if (actions[actionId].status != ActionStatus.NONE) return;
        if (to == address(0)) { emit Layer0Rejected(actionId, to, amount, R_ZERO_ADDR); return; }
        if (amount == 0) { emit Layer0Rejected(actionId, to, amount, R_ZERO_AMOUNT); return; }

        Payee storage payee = payees[to];
        if (payee.registered) {
            if (block.number >= uint256(payee.windowStartBlock) + WINDOW_BLOCKS) {
                payee.windowStartBlock = uint64(block.number);
                payee.spentInWindow = 0;
            }
            if (amount > payee.perTxCap) {
                emit Layer0Rejected(actionId, to, amount, R_OVER_TX_CAP);
                return;
            }
            if (payee.spentInWindow > payee.perWindowCap || amount > payee.perWindowCap - payee.spentInWindow) {
                emit Layer0Rejected(actionId, to, amount, R_OVER_WINDOW_CAP);
                return;
            }
            payee.spentInWindow += amount;
            actions[actionId] = ProposedAction(msg.sender, amount, to, 0, ActionStatus.EXECUTED, intentHash);
            emit ActionProposed(actionId, to, amount, 0, intentHash);
            _pay(actionId, to, amount);
            return;
        }

        if (amount > MAX_NEW_RECIPIENT_PAYOUT) {
            emit Layer0Rejected(actionId, to, amount, R_OVER_TX_CAP);
            return;
        }
        uint64 expires = uint64(block.number) + expiryBlocks;
        actions[actionId] = ProposedAction(msg.sender, amount, to, expires, ActionStatus.PENDING, intentHash);
        emit ActionProposed(actionId, to, amount, expires, intentHash);
    }

    function submitDecision(bytes32 actionId, bool isVeto, uint8 reasonCode) external {
        uint8 guardianId = guardianIndex[msg.sender];
        require(guardianId != 0, "NOT_GUARDIAN");
        if (actions[actionId].status != ActionStatus.PENDING) return;
        bytes32 key = keccak256(abi.encode(actionId, guardianId));
        if (decision[key] != D_NONE) return;
        decision[key] = isVeto ? D_VETO : D_CLEAR;
        emit GuardianDecision(actionId, guardianId, isVeto, reasonCode);
    }

    function executeAction(bytes32 actionId) external {
        ProposedAction storage action = actions[actionId];
        if (action.status != ActionStatus.PENDING) return;

        bool incomplete;
        for (uint8 i = 0; i < 3; i++) {
            uint8 guardianId = i + 1;
            if ((guardianMask & (uint8(1) << i)) == 0) continue;
            uint8 vote = decision[keccak256(abi.encode(actionId, guardianId))];
            if (vote == D_VETO) {
                action.status = ActionStatus.VETOED;
                emit ActionResolved(actionId, ActionStatus.VETOED, action.amount);
                return;
            }
            if (vote == D_NONE) incomplete = true;
        }

        if (incomplete) {
            if (block.number >= action.expireBlock) {
                action.status = ActionStatus.EXPIRED;
                emit ActionResolved(actionId, ActionStatus.EXPIRED, action.amount);
            }
            return;
        }

        action.status = ActionStatus.EXECUTED;
        _pay(actionId, action.to, action.amount);
    }

    function _pay(bytes32 actionId, address to, uint96 amount) internal {
        if (address(this).balance < amount) {
            actions[actionId].status = ActionStatus.PAYOUT_FAILED;
            emit ActionResolved(actionId, ActionStatus.PAYOUT_FAILED, amount);
            return;
        }
        (bool success,) = payable(to).call{value: amount, gas: PAYOUT_GAS_CAP}("");
        if (!success) {
            actions[actionId].status = ActionStatus.PAYOUT_FAILED;
            emit ActionResolved(actionId, ActionStatus.PAYOUT_FAILED, amount);
            return;
        }
        emit ActionResolved(actionId, ActionStatus.EXECUTED, amount);
    }
}
