// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Bounded test-USDC refunds; the registrar is trusted to verify offchain failure.
/// @dev Amounts are ERC-20 units (6 decimals on Arc), never native gas units (18).
contract RefundReserve is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;
    bytes32 public constant REGISTRAR_ROLE = keccak256("REGISTRAR_ROLE");
    bytes32 public constant WORKER_ROLE = keccak256("WORKER_ROLE");
    uint256 public constant DAILY_LIMIT = 10e6;
    IERC20 public immutable token;
    struct Entitlement { address payer; uint256 amount; bool refunded; }
    mapping(bytes32 orderId => Entitlement) public entitlements;
    mapping(uint256 utcDay => uint256 amount) public dailySpent;
    error InvalidInput();
    error AlreadyRegistered();
    error InvalidEntitlement();
    error AlreadyRefunded();
    error DailyLimitExceeded();
    event EntitlementRegistered(bytes32 indexed orderId, address indexed payer, uint256 amount);
    event Refunded(bytes32 indexed orderId, address indexed payer, uint256 amount, uint256 utcDay);

    constructor(address tokenAddress, address administrator, address registrar, address worker) {
        if (tokenAddress.code.length == 0 || administrator == address(0) || registrar == address(0)
            || worker == address(0) || administrator == registrar || administrator == worker || registrar == worker) {
            revert InvalidInput();
        }
        token = IERC20(tokenAddress);
        _grantRole(DEFAULT_ADMIN_ROLE, administrator);
        _grantRole(REGISTRAR_ROLE, registrar);
        _grantRole(WORKER_ROLE, worker);
    }

    function registerEntitlement(bytes32 orderId, address payer, uint256 amount) external onlyRole(REGISTRAR_ROLE) {
        if (orderId == bytes32(0) || payer == address(0) || amount == 0 || amount > DAILY_LIMIT) revert InvalidInput();
        if (entitlements[orderId].payer != address(0)) revert AlreadyRegistered();
        entitlements[orderId] = Entitlement(payer, amount, false);
        emit EntitlementRegistered(orderId, payer, amount);
    }

    function refund(bytes32 orderId, address payer, uint256 amount) external onlyRole(WORKER_ROLE) nonReentrant {
        Entitlement storage entitlement = entitlements[orderId];
        if (entitlement.payer == address(0) || entitlement.payer != payer || entitlement.amount != amount) revert InvalidEntitlement();
        if (entitlement.refunded) revert AlreadyRefunded();
        uint256 day = block.timestamp / 1 days;
        if (dailySpent[day] + amount > DAILY_LIMIT) revert DailyLimitExceeded();
        entitlement.refunded = true;
        dailySpent[day] += amount;
        token.safeTransfer(payer, amount);
        emit Refunded(orderId, payer, amount, day);
    }

    function remainingDailyAllowance() external view returns (uint256) {
        return DAILY_LIMIT - dailySpent[block.timestamp / 1 days];
    }
}
