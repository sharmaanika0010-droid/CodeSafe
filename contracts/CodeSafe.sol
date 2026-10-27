// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title CodeSafe - Blockchain-Based Software Source Code Escrow System
/// @author Anika Sharma (Group 23)
/// @notice The developer deposits encrypted source code and must send a "heartbeat"
///         regularly. If the developer stops (becomes inactive), the client can claim
///         the code and gets the locked payment back. If the work is completed, the
///         client releases the payment to the developer.
contract CodeSafe {
    enum Status { Created, Active, Released, Completed }

    struct Deal {
        uint256 id;
        string title;
        address developer;
        address client;
        uint256 amount;            // payment locked by client (in wei)
        bool funded;
        uint256 heartbeatInterval; // seconds
        uint256 lastHeartbeat;
        uint256 createdAt;
        Status status;
    }

    struct Version {
        uint256 number;
        string fileName;
        string fileId;     // id of encrypted file in storage (like IPFS CID)
        bytes32 codeHash;  // SHA-256 of the original (unencrypted) source code file
        bytes32 keyHash;   // hash of the decryption key
        uint256 time;
        string note;
    }

    uint256 public dealCount;
    mapping(uint256 => Deal) private deals;
    mapping(uint256 => Version[]) private versions;
    mapping(address => string) public names;

    event DealCreated(uint256 indexed id, address indexed developer, address indexed client, string title);
    event DealFunded(uint256 indexed id, uint256 amount);
    event CodeDeposited(uint256 indexed id, uint256 version, bytes32 codeHash);
    event Heartbeat(uint256 indexed id, uint256 time);
    event CodeReleased(uint256 indexed id, address client, uint256 refund);
    event DealCompleted(uint256 indexed id, uint256 paidToDeveloper);

    modifier exists(uint256 id) {
        require(id > 0 && id <= dealCount, "Deal not found");
        _;
    }

    function setName(string memory name) external {
        names[msg.sender] = name;
    }

    // ---------------- Developer ----------------
    function createDeal(string memory title, address client, uint256 heartbeatDays, uint256 amount) external returns (uint256) {
        require(client != address(0) && client != msg.sender, "Invalid client address");
        require(heartbeatDays > 0 && heartbeatDays <= 365, "Heartbeat days must be 1-365");
        require(amount > 0, "Amount must be greater than 0");
        dealCount++;
        deals[dealCount] = Deal(dealCount, title, msg.sender, client, amount, false, heartbeatDays * 1 days, 0,
                                block.timestamp, Status.Created);
        emit DealCreated(dealCount, msg.sender, client, title);
        return dealCount;
    }

    function depositCode(uint256 id, string memory fileName, string memory fileId, bytes32 codeHash, bytes32 keyHash,
                         string memory note) external exists(id) {
        Deal storage d = deals[id];
        require(msg.sender == d.developer, "Only the developer of this deal can deposit code");
        require(d.status == Status.Created || d.status == Status.Active, "Deal is closed");
        versions[id].push(Version(versions[id].length + 1, fileName, fileId, codeHash, keyHash, block.timestamp, note));
        d.lastHeartbeat = block.timestamp; // a new version also counts as a heartbeat
        _tryActivate(d);
        emit CodeDeposited(id, versions[id].length, codeHash);
    }

    function heartbeat(uint256 id) external exists(id) {
        Deal storage d = deals[id];
        require(msg.sender == d.developer, "Only the developer can send heartbeat");
        require(d.status == Status.Active, "Deal is not active");
        require(!isInactive(id), "Too late: heartbeat deadline already missed");
        d.lastHeartbeat = block.timestamp;
        emit Heartbeat(id, block.timestamp);
    }

    // ---------------- Client ----------------
    function fundDeal(uint256 id) external payable exists(id) {
        Deal storage d = deals[id];
        require(msg.sender == d.client, "Only the client of this deal can pay");
        require(!d.funded, "Already funded");
        require(msg.value == d.amount, "Send the exact deal amount");
        d.funded = true;
        _tryActivate(d);
        emit DealFunded(id, msg.value);
    }

    /// Client claims the source code when the developer has become inactive.
    function claimCode(uint256 id) external exists(id) {
        Deal storage d = deals[id];
        require(msg.sender == d.client, "Only the client can claim the code");
        require(d.status == Status.Active, "Deal is not active");
        require(isInactive(id), "Developer is still active - code cannot be released yet");
        d.status = Status.Released;
        uint256 refund = d.amount;
        d.amount = 0;
        payable(d.client).transfer(refund);
        emit CodeReleased(id, d.client, refund);
    }

    /// Client is happy with the work: payment goes to developer, deal closes.
    function completeDeal(uint256 id) external exists(id) {
        Deal storage d = deals[id];
        require(msg.sender == d.client, "Only the client can complete the deal");
        require(d.status == Status.Active, "Deal is not active");
        d.status = Status.Completed;
        uint256 pay = d.amount;
        d.amount = 0;
        payable(d.developer).transfer(pay);
        emit DealCompleted(id, pay);
    }

    // ---------------- Read functions ----------------
    function isInactive(uint256 id) public view returns (bool) {
        Deal storage d = deals[id];
        return d.status == Status.Active && block.timestamp > d.lastHeartbeat + d.heartbeatInterval;
    }

    function getDeal(uint256 id) external view exists(id) returns (Deal memory) {
        return deals[id];
    }

    function getVersions(uint256 id) external view exists(id) returns (Version[] memory) {
        return versions[id];
    }

    function _tryActivate(Deal storage d) internal {
        if (d.status == Status.Created && d.funded && versions[d.id].length > 0) {
            d.status = Status.Active;
            d.lastHeartbeat = block.timestamp;
        }
    }
}
