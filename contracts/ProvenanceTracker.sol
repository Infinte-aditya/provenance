// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev Minimal enumerable set of product ids with O(1) add/remove.
library IdSet {
    struct Set {
        uint256[] ids;
        mapping(uint256 => uint256) pos; // index + 1; 0 means "not in set"
    }

    function add(Set storage s, uint256 id) internal {
        s.ids.push(id);
        s.pos[id] = s.ids.length;
    }

    function remove(Set storage s, uint256 id) internal {
        uint256 p = s.pos[id];
        if (p == 0) return;
        uint256 last = s.ids[s.ids.length - 1];
        s.ids[p - 1] = last;
        s.pos[last] = p;
        s.ids.pop();
        delete s.pos[id];
    }
}

/// @title ProvenanceTracker
/// @notice Tracks goods from producer to retailer with a tamper-proof custody trail.
/// @dev Permissioned: the owner (admin) registers participants and assigns roles.
///      Custody changes use a two-step handover: the sender proposes, the receiver accepts.
contract ProvenanceTracker {
    using IdSet for IdSet.Set;

    // ───────────── Types ─────────────
    enum Role { None, Producer, Transporter, Warehouse, Retailer }
    enum Status { Created, InTransit, InWarehouse, AtRetailer, Delivered, Recalled }

    struct Participant {
        Role role;
        bool active;
        string name;
    }

    struct ParticipantView {
        address account;
        Role role;
        bool active;
        string name;
    }

    struct Product {
        uint256 id;
        string name;
        string origin;
        address producer;
        address custodian;
        Status status;
        uint64 createdAt;
    }

    struct Checkpoint {
        address handler;
        string location;
        string note;
        bytes32 evidence; // SHA-256 of an off-chain document/photo; zero if none
        Status status;
        uint64 timestamp;
    }

    struct Transfer {
        address to; // zero address means "no pending transfer"
        string location;
        string note;
        bytes32 evidence;
    }

    // ───────────── State ─────────────
    address public owner;
    bool public paused;
    uint256 public productCount;

    mapping(address => Participant) private _participants;
    mapping(address => bool) private _known;
    address[] private _participantList;

    mapping(uint256 => Product) private _products;
    mapping(uint256 => Checkpoint[]) private _history;
    mapping(uint256 => Transfer) private _pending;

    mapping(address => IdSet.Set) private _made;     // products a producer created
    mapping(address => IdSet.Set) private _held;     // products currently in someone's custody
    mapping(address => IdSet.Set) private _incoming; // handovers waiting for someone to accept

    uint256 private constant MAX_STR = 128; // bounds storage and gas per call

    // ───────────── Events ─────────────
    event ParticipantSet(address indexed account, Role role, string name);
    event ParticipantRemoved(address indexed account);
    event ProductRegistered(uint256 indexed id, address indexed producer, string name, string origin);
    event TransferInitiated(uint256 indexed id, address indexed from, address indexed to);
    event TransferCancelled(uint256 indexed id, address indexed from, address indexed to);
    event CustodyTransferred(uint256 indexed id, address indexed from, address indexed to);
    event CheckpointAdded(uint256 indexed id, address indexed handler, Status status, string location);
    event ProductRecalled(uint256 indexed id, address indexed by, string reason);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event Paused(address indexed by);
    event Unpaused(address indexed by);

    // ───────────── Errors ─────────────
    error NotOwner();
    error NotAuthorized();
    error NotCustodian();
    error NotReceiver();
    error UnknownProduct();
    error InvalidAddress();
    error InvalidRole();
    error StringTooLong();
    error EmptyString();
    error ProductClosed();
    error NotRegistered();
    error TransferPending();
    error NoPendingTransfer();
    error ContractPaused();
    error NotPaused();

    // ───────────── Modifiers ─────────────
    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert ContractPaused();
        _;
    }

    modifier productExists(uint256 id) {
        if (id == 0 || id > productCount) revert UnknownProduct();
        _;
    }

    modifier onlyCustodian(uint256 id) {
        if (_products[id].custodian != msg.sender) revert NotCustodian();
        if (!_participants[msg.sender].active) revert NotAuthorized();
        _;
    }

    modifier open(uint256 id) {
        Status s = _products[id].status;
        if (s == Status.Delivered || s == Status.Recalled) revert ProductClosed();
        _;
    }

    modifier noPending(uint256 id) {
        if (_pending[id].to != address(0)) revert TransferPending();
        _;
    }

    constructor() {
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    // ───────────── Admin ─────────────
    /// @notice Add a participant, change their role/name, or reactivate a removed one.
    function setParticipant(address account, Role role, string calldata name) external onlyOwner {
        if (account == address(0)) revert InvalidAddress();
        if (role == Role.None) revert InvalidRole();
        _validate(name);
        if (!_known[account]) {
            _known[account] = true;
            _participantList.push(account);
        }
        _participants[account] = Participant(role, true, name);
        emit ParticipantSet(account, role, name);
    }

    /// @notice Deactivate a participant. Their history stays on-chain; they can no longer act.
    function removeParticipant(address account) external onlyOwner {
        if (!_known[account]) revert NotRegistered();
        _participants[account].active = false;
        emit ParticipantRemoved(account);
    }

    function pause() external onlyOwner {
        if (paused) revert ContractPaused();
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOwner {
        if (!paused) revert NotPaused();
        paused = false;
        emit Unpaused(msg.sender);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    // ───────────── Core logic ─────────────
    /// @notice An active Producer creates a product record and becomes its first custodian.
    function registerProduct(string calldata name, string calldata origin)
        external
        whenNotPaused
        returns (uint256 id)
    {
        Participant storage p = _participants[msg.sender];
        if (!p.active || p.role != Role.Producer) revert NotAuthorized();
        _validate(name);
        _validate(origin);

        id = ++productCount;
        _products[id] = Product(id, name, origin, msg.sender, msg.sender, Status.Created, uint64(block.timestamp));
        _history[id].push(Checkpoint(msg.sender, origin, "Registered", bytes32(0), Status.Created, uint64(block.timestamp)));
        _made[msg.sender].add(id);
        _held[msg.sender].add(id);

        emit ProductRegistered(id, msg.sender, name, origin);
    }

    /// @notice Step 1 of a handover: the custodian proposes to pass the product to `to`.
    function initiateTransfer(
        uint256 id,
        address to,
        string calldata location,
        string calldata note,
        bytes32 evidence
    ) external whenNotPaused productExists(id) onlyCustodian(id) open(id) noPending(id) {
        if (to == address(0) || to == msg.sender) revert InvalidAddress();
        if (!_participants[to].active) revert NotRegistered();
        _validate(location);
        _validateOptional(note);

        _pending[id] = Transfer(to, location, note, evidence);
        _incoming[to].add(id);
        emit TransferInitiated(id, msg.sender, to);
    }

    /// @notice The custodian withdraws a handover that has not been accepted yet.
    function cancelTransfer(uint256 id) external whenNotPaused productExists(id) onlyCustodian(id) {
        address to = _pending[id].to;
        if (to == address(0)) revert NoPendingTransfer();
        _clearPending(id, to);
        emit TransferCancelled(id, msg.sender, to);
    }

    /// @notice Step 2 of a handover: the receiver takes custody; the checkpoint is recorded now.
    function acceptTransfer(uint256 id) external whenNotPaused productExists(id) {
        Transfer memory t = _pending[id];
        if (t.to == address(0)) revert NoPendingTransfer();
        if (t.to != msg.sender) revert NotReceiver();
        Participant storage p = _participants[msg.sender];
        if (!p.active) revert NotRegistered();

        Product storage prod = _products[id];
        address from = prod.custodian;
        _held[from].remove(id);
        _held[msg.sender].add(id);
        prod.custodian = msg.sender;

        Status s = _statusFor(p.role);
        prod.status = s;
        _clearPending(id, msg.sender);
        _history[id].push(Checkpoint(msg.sender, t.location, t.note, t.evidence, s, uint64(block.timestamp)));

        emit CustodyTransferred(id, from, msg.sender);
        emit CheckpointAdded(id, msg.sender, s, t.location);
    }

    /// @notice Custodian logs an intermediate event (temperature check, border crossing, ...).
    function addCheckpoint(uint256 id, string calldata location, string calldata note, bytes32 evidence)
        external
        whenNotPaused
        productExists(id)
        onlyCustodian(id)
        open(id)
        noPending(id)
    {
        _validate(location);
        _validateOptional(note);
        Status s = _products[id].status;
        _history[id].push(Checkpoint(msg.sender, location, note, evidence, s, uint64(block.timestamp)));
        emit CheckpointAdded(id, msg.sender, s, location);
    }

    /// @notice A Retailer custodian confirms final delivery; the record is then sealed.
    function confirmDelivery(uint256 id, string calldata location, bytes32 evidence)
        external
        whenNotPaused
        productExists(id)
        onlyCustodian(id)
        open(id)
        noPending(id)
    {
        if (_participants[msg.sender].role != Role.Retailer) revert NotAuthorized();
        _validate(location);
        _products[id].status = Status.Delivered;
        _history[id].push(Checkpoint(msg.sender, location, "Delivered", evidence, Status.Delivered, uint64(block.timestamp)));
        emit CheckpointAdded(id, msg.sender, Status.Delivered, location);
    }

    /// @notice The owner, or the (active) producer of the product, recalls an unsealed product.
    /// @dev Still works while paused so a safety recall is never blocked.
    function recall(uint256 id, string calldata reason) external productExists(id) open(id) {
        Product storage p = _products[id];
        bool isProducer = msg.sender == p.producer && _participants[msg.sender].active;
        if (msg.sender != owner && !isProducer) revert NotAuthorized();
        _validate(reason);

        address to = _pending[id].to;
        if (to != address(0)) _clearPending(id, to);

        p.status = Status.Recalled;
        _history[id].push(Checkpoint(msg.sender, "", reason, bytes32(0), Status.Recalled, uint64(block.timestamp)));
        emit ProductRecalled(id, msg.sender, reason);
    }

    // ───────────── Views ─────────────
    function getProduct(uint256 id) external view productExists(id) returns (Product memory) {
        return _products[id];
    }

    function getHistory(uint256 id) external view productExists(id) returns (Checkpoint[] memory) {
        return _history[id];
    }

    function pendingTransfer(uint256 id) external view productExists(id) returns (Transfer memory) {
        return _pending[id];
    }

    function participantOf(address account) external view returns (Participant memory) {
        return _participants[account];
    }

    function getParticipants() external view returns (ParticipantView[] memory list) {
        uint256 n = _participantList.length;
        list = new ParticipantView[](n);
        for (uint256 i; i < n; ++i) {
            address a = _participantList[i];
            Participant storage p = _participants[a];
            list[i] = ParticipantView(a, p.role, p.active, p.name);
        }
    }

    function productsMadeBy(address producer) external view returns (uint256[] memory) {
        return _made[producer].ids;
    }

    function productsHeldBy(address custodian) external view returns (uint256[] memory) {
        return _held[custodian].ids;
    }

    function incomingFor(address receiver) external view returns (uint256[] memory) {
        return _incoming[receiver].ids;
    }

    // ───────────── Internals ─────────────
    function _clearPending(uint256 id, address to) private {
        _incoming[to].remove(id);
        delete _pending[id];
    }

    function _validate(string calldata s) private pure {
        uint256 len = bytes(s).length;
        if (len == 0) revert EmptyString();
        if (len > MAX_STR) revert StringTooLong();
    }

    function _validateOptional(string calldata s) private pure {
        if (bytes(s).length > MAX_STR) revert StringTooLong();
    }

    function _statusFor(Role r) private pure returns (Status) {
        if (r == Role.Transporter) return Status.InTransit;
        if (r == Role.Warehouse) return Status.InWarehouse;
        if (r == Role.Retailer) return Status.AtRetailer;
        return Status.Created; // handed back to a producer (e.g., a return)
    }
}
