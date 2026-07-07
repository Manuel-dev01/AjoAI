// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { ICircle } from "./interfaces/ICircle.sol";
import { IReputation } from "./interfaces/IReputation.sol";
import { IYieldAdapter } from "./interfaces/IYieldAdapter.sol";
import { ISelfVerifier } from "./interfaces/ISelfVerifier.sol";

/// @title Circle — one autonomous rotating-savings circle (ROSCA). Single token per circle.
/// @notice Contract is the SOURCE OF TRUTH and ENFORCES all money rules (CLAUDE.md §1).
///         The agent only triggers legal transitions. See docs/STATE_MACHINE.md.
contract Circle is ICircle, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Immutable config ──────────────────────────────────
    IERC20 public immutable token;
    uint256 public immutable contribution; // per-round amount (token smallest unit)
    uint256 public immutable deposit; // security deposit == one contribution
    uint256 public immutable period; // contribution window length (seconds)
    uint256 public immutable graceWindow; // late sub-window after the window (seconds)
    uint16 public immutable penaltyBps; // late penalty = penaltyBps * contribution / 10_000
    uint8 public immutable slots; // N members / N rounds
    address public immutable organizer;
    address public immutable agent; // minimal-rights trigger key (CLAUDE.md §1.1)

    ISelfVerifier public immutable selfVerifier; // address(0) => OPEN dev mode (loud)
    IReputation public immutable reputation; // address(0) => no-op
    IYieldAdapter public yieldAdapter; // optional; settable by organizer pre-start (setYieldAdapter)

    // After a round's recipient has been withheld (delinquent) this long without curing, the agent
    // can force the circle to DEFAULTED so funds are never permanently frozen (CLAUDE.md §4).
    uint256 public immutable withholdTimeout;

    uint256 internal constant BPS = 10_000;

    // ─── Mutable state ─────────────────────────────────────
    State public state;
    address[] public members;
    address[] public rotation;
    bool public rotationSet;

    mapping(address => bool) public isMember;
    mapping(address => uint256) public memberIndex; // 1-based; 0 == not member
    mapping(address => bool) public hasReceived;
    mapping(address => bool) public isDelinquent;
    mapping(address => bool) public everDelinquent;
    mapping(address => uint256) public depositBalance; // remaining deposit per member
    mapping(bytes32 => bool) public usedHuman; // one human, one slot (per circle)

    uint256 public currentRound; // 0-based round index
    uint256 public roundsPaid;
    uint256 public roundStartTime; // start of the current round's window
    uint256 public penaltyPool; // penalties (+ any pooled bonus) for compliant members
    uint256 public parkedAmount; // principal currently in the yield venue

    mapping(uint256 => uint256) public roundPot; // funded amount earmarked for round r
    mapping(uint256 => mapping(address => bool)) public contributedInRound;
    mapping(uint256 => mapping(address => bool)) internal _defaultHandled;
    mapping(uint256 => uint256) public withheldSince; // round -> first-withheld timestamp (0 = not withheld)

    // Reconciliation totals (CLAUDE.md §1.10 — no wei created/destroyed)
    uint256 public totalDepositsIn;
    uint256 public totalContributionsIn;
    uint256 public totalPenaltiesIn;
    uint256 public totalPayoutsOut;
    uint256 public totalDepositsReturned;
    uint256 public totalPenaltiesDistributed;
    uint256 public totalDefaultDistributed;
    uint256 public totalExitRefunds;

    // Reputation signal magnitudes (CLAUDE.md §4 mapping)
    int256 internal constant REP_ON_TIME = 1;
    int256 internal constant REP_LATE = -1;
    int256 internal constant REP_DEFAULT = -5;
    int256 internal constant REP_COMPLETED = 5;

    // ─── Errors ────────────────────────────────────────────
    error NotOrganizer();
    error NotAgent();
    error NotMember();
    error WrongState();
    error SlotsFull();
    error AlreadyMember();
    error HumanAlreadyUsed();
    error NotFull();
    error RotationInvalid();
    error AlreadyContributed();
    error PastGrace();
    error WindowNotElapsed();
    error NotDelinquent();
    error AlreadyReceived();
    error NothingParked();
    error MustWithdrawIdleFirst();
    error NoYieldAdapter();
    error ExitNotAllowed();
    error RoundsRemaining();

    modifier onlyOrganizer() {
        if (msg.sender != organizer) revert NotOrganizer();
        _;
    }

    modifier onlyAgent() {
        if (msg.sender != agent) revert NotAgent();
        _;
    }

    modifier inState(State s) {
        if (state != s) revert WrongState();
        _;
    }

    struct Config {
        address token;
        uint256 contribution;
        uint256 period;
        uint256 graceWindow;
        uint16 penaltyBps;
        uint8 slots;
        address organizer;
        address agent;
        address selfVerifier;
        address reputation;
        address yieldAdapter;
    }

    constructor(Config memory c) {
        require(c.token != address(0), "token=0");
        require(c.contribution > 0, "contribution=0");
        require(c.slots >= 2, "slots<2");
        require(c.penaltyBps <= BPS, "penalty>100%");
        require(c.agent != address(0), "agent=0");
        token = IERC20(c.token);
        contribution = c.contribution;
        deposit = c.contribution; // deposit == one contribution (CLAUDE.md §4)
        period = c.period;
        graceWindow = c.graceWindow;
        penaltyBps = c.penaltyBps;
        slots = c.slots;
        organizer = c.organizer;
        agent = c.agent;
        selfVerifier = ISelfVerifier(c.selfVerifier);
        reputation = IReputation(c.reputation);
        yieldAdapter = IYieldAdapter(c.yieldAdapter);
        // Cure window before a stuck (uncured-delinquent recipient) round can be force-defaulted.
        // Derived from the circle's own cadence: two full round-windows. No extra config needed.
        withholdTimeout = 2 * (c.period + c.graceWindow);
        state = State.Forming;
    }

    // ─── Views ─────────────────────────────────────────────

    function intendedPot() public view returns (uint256) {
        return uint256(slots) * contribution;
    }

    function recipientOf(uint256 round) public view returns (address) {
        return rotation[round];
    }

    function membersLength() external view returns (uint256) {
        return members.length;
    }

    function windowClose(uint256) public view returns (uint256) {
        return roundStartTime + period;
    }

    function graceClose(uint256) public view returns (uint256) {
        return roundStartTime + period + graceWindow;
    }

    function reconcile() public view returns (uint256 inSum, uint256 outSum) {
        inSum = totalDepositsIn + totalContributionsIn + totalPenaltiesIn;
        outSum = totalPayoutsOut + totalDepositsReturned + totalPenaltiesDistributed
            + totalDefaultDistributed + totalExitRefunds;
    }

    // ─── FORMING ───────────────────────────────────────────

    function join(bytes calldata selfProof) external nonReentrant inState(State.Forming) {
        if (members.length >= slots) revert SlotsFull();
        if (isMember[msg.sender]) revert AlreadyMember();

        bytes32 humanId;
        if (address(selfVerifier) != address(0)) {
            humanId = selfVerifier.verify(msg.sender, selfProof);
        } else {
            // OPEN dev mode (no personhood gate) — surfaced loudly off-chain via this event.
            humanId = bytes32(uint256(uint160(msg.sender)));
        }
        if (usedHuman[humanId]) revert HumanAlreadyUsed();
        usedHuman[humanId] = true;

        isMember[msg.sender] = true;
        members.push(msg.sender);
        memberIndex[msg.sender] = members.length; // 1-based
        depositBalance[msg.sender] = deposit;
        totalDepositsIn += deposit;

        token.safeTransferFrom(msg.sender, address(this), deposit);
        emit MemberJoined(msg.sender, deposit, members.length - 1);
    }

    function setRotation(address[] calldata order) external onlyOrganizer inState(State.Forming) {
        if (order.length != members.length || order.length != slots) revert RotationInvalid();
        // must be a permutation of current members
        bool[] memory seen = new bool[](order.length);
        for (uint256 i = 0; i < order.length; i++) {
            uint256 idx = memberIndex[order[i]];
            if (idx == 0) revert RotationInvalid();
            if (seen[idx - 1]) revert RotationInvalid();
            seen[idx - 1] = true;
        }
        rotation = order;
        rotationSet = true;
        emit RotationSet(order);
    }

    function start() external inState(State.Forming) {
        if (msg.sender != organizer && msg.sender != agent) revert NotOrganizer();
        if (members.length != slots) revert NotFull();
        if (!rotationSet) {
            rotation = members; // default rotation = join order
            rotationSet = true;
            emit RotationSet(members);
        }
        state = State.Active;
        currentRound = 0;
        roundStartTime = block.timestamp;
        emit CircleStarted(block.timestamp, slots);
    }

    /// @notice Attach/replace the yield adapter before the circle starts. Previously the "settable
    /// pre-start" comment had no setter, so a circle created with yieldAdapter==0 could never park.
    function setYieldAdapter(address adapter) external onlyOrganizer inState(State.Forming) {
        yieldAdapter = IYieldAdapter(adapter);
        emit YieldAdapterSet(adapter);
    }

    function dissolve() external nonReentrant onlyOrganizer inState(State.Forming) {
        state = State.Dissolved;
        uint256 len = members.length;
        for (uint256 i = 0; i < len; i++) {
            address m = members[i];
            uint256 bal = depositBalance[m];
            if (bal > 0) {
                depositBalance[m] = 0;
                totalDepositsReturned += bal;
                token.safeTransfer(m, bal);
            }
        }
        emit CircleDissolved();
    }

    function requestExit() external nonReentrant inState(State.Forming) {
        // v1: clean exit only during FORMING (mid-ACTIVE resize deferred — see STATE_MACHINE §5.7).
        if (!isMember[msg.sender]) revert NotMember();
        uint256 bal = depositBalance[msg.sender];
        _removeMember(msg.sender);
        if (bal > 0) {
            depositBalance[msg.sender] = 0;
            totalExitRefunds += bal;
            token.safeTransfer(msg.sender, bal);
        }
        emit MemberExited(msg.sender, bal);
    }

    function _removeMember(address m) internal {
        uint256 idx = memberIndex[m]; // 1-based
        uint256 last = members.length;
        if (idx != last) {
            address moved = members[last - 1];
            members[idx - 1] = moved;
            memberIndex[moved] = idx;
        }
        members.pop();
        delete memberIndex[m];
        delete isMember[m];
        // free the human slot
        usedHuman[bytes32(uint256(uint160(m)))] = false; // only valid in OPEN mode; harmless otherwise
    }

    // ─── ACTIVE: contributions ─────────────────────────────

    function contribute() external nonReentrant inState(State.Active) {
        if (!isMember[msg.sender]) revert NotMember();
        uint256 cr = currentRound;
        if (contributedInRound[cr][msg.sender]) revert AlreadyContributed();

        uint256 nowTs = block.timestamp;
        bool late;
        if (nowTs < windowClose(cr)) {
            late = false;
        } else if (nowTs < graceClose(cr)) {
            late = true;
        } else {
            revert PastGrace(); // must be covered via markDelinquent / cure
        }

        contributedInRound[cr][msg.sender] = true;
        roundPot[cr] += contribution;
        totalContributionsIn += contribution;
        token.safeTransferFrom(msg.sender, address(this), contribution);

        if (late) {
            uint256 penalty = (contribution * penaltyBps) / BPS;
            if (penalty > 0) {
                penaltyPool += penalty;
                totalPenaltiesIn += penalty;
                token.safeTransferFrom(msg.sender, address(this), penalty);
                emit LatePaid(msg.sender, cr, penalty);
            }
            _writeRep(msg.sender, REP_LATE, "late");
        } else {
            _writeRep(msg.sender, REP_ON_TIME, "on_time");
        }
        emit Contributed(msg.sender, cr, contribution, late);
    }

    function markDelinquent(address member) external onlyAgent inState(State.Active) {
        uint256 cr = currentRound;
        if (block.timestamp < graceClose(cr)) revert WindowNotElapsed();
        _handleDefault(cr, member);
    }

    /// @dev Consume `member`'s deposit (up to one contribution) to cover their missed round.
    function _handleDefault(uint256 cr, address member) internal {
        if (!isMember[member]) revert NotMember();
        if (contributedInRound[cr][member]) return; // they paid; nothing to do
        if (_defaultHandled[cr][member]) return; // idempotent
        _defaultHandled[cr][member] = true;

        uint256 cover = depositBalance[member];
        if (cover > contribution) cover = contribution;
        if (cover > 0) {
            depositBalance[member] -= cover;
            roundPot[cr] += cover; // deposit forfeited into the pot -> recipient made whole
        }
        isDelinquent[member] = true;
        everDelinquent[member] = true;
        emit Delinquent(member, cr, cover);
        _writeRep(member, REP_DEFAULT, "default");
    }

    function cure() external nonReentrant inState(State.Active) {
        if (!isDelinquent[msg.sender]) revert NotDelinquent();
        isDelinquent[msg.sender] = false;
        depositBalance[msg.sender] += deposit; // restore the security buffer
        totalDepositsIn += deposit;
        token.safeTransferFrom(msg.sender, address(this), deposit);
        emit Cured(msg.sender, deposit);
    }

    // ─── ACTIVE: payout ────────────────────────────────────

    function triggerPayout() external nonReentrant onlyAgent inState(State.Active) {
        if (parkedAmount != 0) revert MustWithdrawIdleFirst();
        uint256 cr = currentRound;
        address recipient = rotation[cr];

        // Recipient-is-delinquent (from a prior round): WITHHELD (not skipped). No state change; the
        // agent retries post-cure, or force-defaults after withholdTimeout (never a permanent freeze).
        if (isDelinquent[recipient]) {
            _withhold(cr, recipient);
            return;
        }

        uint256 pot = intendedPot();
        if (roundPot[cr] < pot) {
            // Need grace to have elapsed so post-grace misses can be covered from deposits.
            if (block.timestamp < graceClose(cr)) revert WindowNotElapsed();
            _coverRound(cr);
            // BUG FIX: _coverRound may have just marked the RECIPIENT delinquent — they missed their
            // OWN round. Withhold instead of paying them the pot out of their own forfeited deposit
            // (CLAUDE.md §4: recipient-is-delinquent => withheld until cured).
            if (isDelinquent[recipient]) {
                _withhold(cr, recipient);
                return;
            }
        }

        uint256 available = roundPot[cr] + penaltyPool;
        if (available < pot) {
            _defaultSettle();
            return;
        }

        // Top up any remaining shortfall from the penalty pool.
        if (roundPot[cr] < pot) {
            uint256 short = pot - roundPot[cr];
            penaltyPool -= short;
            roundPot[cr] = pot;
        }

        // EFFECTS before INTERACTION (CEI) — double-trigger impossible (received set first).
        hasReceived[recipient] = true;
        roundsPaid += 1;
        totalPayoutsOut += pot;
        currentRound = cr + 1;
        if (currentRound < slots) {
            roundStartTime = block.timestamp; // next round's window starts now
        }

        token.safeTransfer(recipient, pot);
        emit PaidOut(recipient, cr, pot);
    }

    /// @dev Auto-mark every post-grace misser for round `cr`, consuming their deposits.
    function _coverRound(uint256 cr) internal {
        uint256 len = members.length; // bounded by slots (small) — not gas-grief
        for (uint256 i = 0; i < len; i++) {
            address m = members[i];
            if (!contributedInRound[cr][m] && !_defaultHandled[cr][m]) {
                _handleDefault(cr, m);
            }
        }
    }

    /// @dev Record a withheld payout (stamp the cure-timer once) and emit. No tokens move.
    function _withhold(uint256 cr, address recipient) internal {
        if (withheldSince[cr] == 0) withheldSince[cr] = block.timestamp;
        emit PayoutWithheld(recipient, cr);
    }

    /// @notice Recovery path for a round whose recipient is delinquent and never cures — otherwise
    /// `triggerPayout` withholds forever and `finalize` reverts (roundsPaid != slots), freezing every
    /// deposit + pot. After `withholdTimeout` past the first withhold, the agent settles to DEFAULTED,
    /// distributing remaining funds pro-rata to not-yet-received members (CLAUDE.md §4).
    function forceDefaultUncured() external nonReentrant onlyAgent inState(State.Active) {
        if (parkedAmount != 0) revert MustWithdrawIdleFirst(); // recall principal first
        uint256 cr = currentRound;
        address recipient = rotation[cr];
        if (!isDelinquent[recipient]) revert NotDelinquent(); // cured or never withheld -> use triggerPayout
        uint256 since = withheldSince[cr];
        if (since == 0 || block.timestamp < since + withholdTimeout) revert WindowNotElapsed();
        _defaultSettle();
    }

    function _defaultSettle() internal {
        state = State.Defaulted;
        // Distribute everything remaining pro-rata to members who have NOT yet received.
        address[] memory eligible = _notReceivedMembers();
        uint256 bal = token.balanceOf(address(this)) - parkedAmount;
        _distributePro(eligible, bal);
        totalDefaultDistributed += bal;
        emit CircleDefaulted(bal);
    }

    // ─── ACTIVE: idle-fund yield (principal round-trip; rate simulated loudly off-chain) ───

    function parkIdleFunds() external nonReentrant onlyAgent inState(State.Active) {
        if (address(yieldAdapter) == address(0)) revert NoYieldAdapter();
        if (parkedAmount != 0) revert MustWithdrawIdleFirst();
        uint256 bal = token.balanceOf(address(this));
        if (bal == 0) revert NothingParked();
        parkedAmount = bal;
        token.safeTransfer(address(yieldAdapter), bal);
        yieldAdapter.deposit(address(token), bal);
        emit IdleFundsParked(bal);
    }

    function withdrawIdleFunds() external nonReentrant onlyAgent inState(State.Active) {
        if (address(yieldAdapter) == address(0)) revert NoYieldAdapter();
        if (parkedAmount == 0) revert NothingParked();
        parkedAmount = 0;
        (uint256 principal, uint256 yieldAccrued) = yieldAdapter.withdrawAll(address(token));
        // Any real yield is pooled as a bonus for compliant members (kept 0 in pure-sim mode).
        if (yieldAccrued > 0) {
            penaltyPool += yieldAccrued;
            totalPenaltiesIn += yieldAccrued;
        }
        emit IdleFundsWithdrawn(principal, yieldAccrued);
    }

    // ─── END ───────────────────────────────────────────────

    function finalize() external nonReentrant inState(State.Active) {
        if (roundsPaid != slots) revert RoundsRemaining();
        state = State.Completed;

        // Return remaining deposits to each member.
        uint256 len = members.length;
        for (uint256 i = 0; i < len; i++) {
            address m = members[i];
            uint256 bal = depositBalance[m];
            if (bal > 0) {
                depositBalance[m] = 0;
                totalDepositsReturned += bal;
                token.safeTransfer(m, bal);
            }
            if (!everDelinquent[m]) {
                _writeRep(m, REP_COMPLETED, "completed");
            }
        }

        // Distribute the penalty (+bonus) pool to never-delinquent members.
        if (penaltyPool > 0) {
            address[] memory good = _compliantMembers();
            uint256 amt = penaltyPool;
            penaltyPool = 0;
            if (good.length > 0) {
                _distributePro(good, amt);
                totalPenaltiesDistributed += amt;
            } else {
                // No eligible members: return to organizer to avoid stuck funds.
                totalPenaltiesDistributed += amt;
                token.safeTransfer(organizer, amt);
            }
        }
        emit CircleCompleted();
    }

    // ─── Internal helpers ──────────────────────────────────

    function _notReceivedMembers() internal view returns (address[] memory list) {
        uint256 len = members.length;
        uint256 n;
        for (uint256 i = 0; i < len; i++) {
            if (!hasReceived[members[i]]) n++;
        }
        list = new address[](n);
        uint256 j;
        for (uint256 i = 0; i < len; i++) {
            if (!hasReceived[members[i]]) list[j++] = members[i];
        }
    }

    function _compliantMembers() internal view returns (address[] memory list) {
        uint256 len = members.length;
        uint256 n;
        for (uint256 i = 0; i < len; i++) {
            if (!everDelinquent[members[i]]) n++;
        }
        list = new address[](n);
        uint256 j;
        for (uint256 i = 0; i < len; i++) {
            if (!everDelinquent[members[i]]) list[j++] = members[i];
        }
    }

    /// @dev Floor division; remainder to the lowest-index eligible member (CLAUDE.md §4 rounding).
    function _distributePro(address[] memory eligible, uint256 amount) internal {
        uint256 n = eligible.length;
        if (n == 0 || amount == 0) return;
        uint256 each = amount / n;
        uint256 remainder = amount - (each * n);
        for (uint256 i = 0; i < n; i++) {
            uint256 share = each + (i == 0 ? remainder : 0);
            if (share > 0) token.safeTransfer(eligible[i], share);
        }
    }

    function _writeRep(address member, int256 delta, string memory reason) internal {
        if (address(reputation) != address(0)) {
            // Never let a reputation write block a money path (try/catch swallow).
            try reputation.write(member, delta, reason) { } catch { }
        }
        emit ReputationWritten(member, delta, reason);
    }
}
