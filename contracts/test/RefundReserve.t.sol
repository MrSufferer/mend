// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {RefundReserve} from "../src/RefundReserve.sol";
contract TestUSDC is ERC20 {
 constructor() ERC20("Test USDC", "USDC") {}
 function mint(address to, uint256 amount) external { _mint(to, amount); }
 function decimals() public pure override returns (uint8) { return 6; }
}
contract RefundReserveTest is Test {
 TestUSDC token;
 RefundReserve reserve;
 address registrar = address(0x11);
 address worker = address(0x22);
 address payer = address(0x33);
 bytes32 order = keccak256("failed-order");
 function setUp() public {
  token = new TestUSDC();
  reserve = new RefundReserve(address(token), address(this), registrar, worker);
  token.mint(address(reserve), 30e6);
 }
 function register(bytes32 id, uint256 amount) internal {
  vm.prank(registrar); reserve.registerEntitlement(id, payer, amount);
 }
 function testOriginalPayerReceivesExactRefund() public {
  register(order, 1e6);
  vm.prank(worker); reserve.refund(order, payer, 1e6);
  assertEq(token.balanceOf(payer), 1e6);
  assertEq(token.balanceOf(address(reserve)), 29e6);
 }
 function testUnauthorizedRolesCannotAuthorizeOrSpend() public {
  vm.expectRevert(); vm.prank(worker); reserve.registerEntitlement(order, payer, 1e6);
  register(order, 1e6);
  vm.expectRevert(); vm.prank(registrar); reserve.refund(order, payer, 1e6);
  bytes32 role = reserve.REGISTRAR_ROLE();
  vm.expectRevert(); vm.prank(worker); reserve.grantRole(role, worker);
 }
 function testWrongPayerAmountAndMissingEntitlementRejected() public {
  register(order, 1e6);
  vm.startPrank(worker);
  vm.expectRevert(RefundReserve.InvalidEntitlement.selector); reserve.refund(order, address(0x44), 1e6);
  vm.expectRevert(RefundReserve.InvalidEntitlement.selector); reserve.refund(order, payer, 2e6);
  vm.expectRevert(RefundReserve.InvalidEntitlement.selector); reserve.refund(bytes32(uint256(99)), payer, 1e6);
  vm.stopPrank(); assertEq(token.balanceOf(payer), 0);
 }
 function testEntitlementCannotBeReplacedOrRefundReplayed() public {
  register(order, 1e6);
  vm.expectRevert(RefundReserve.AlreadyRegistered.selector); register(order, 2e6);
  vm.prank(worker); reserve.refund(order, payer, 1e6);
  vm.expectRevert(RefundReserve.AlreadyRefunded.selector); vm.prank(worker); reserve.refund(order, payer, 1e6);
  assertEq(token.balanceOf(payer), 1e6);
 }
 function testCumulativeDailyLimitAndUtcMidnightReset() public {
  vm.warp(2 days - 1);
  register(order, 6e6); register(bytes32(uint256(2)), 4e6); register(bytes32(uint256(3)), 1e6);
  vm.startPrank(worker); reserve.refund(order, payer, 6e6); reserve.refund(bytes32(uint256(2)), payer, 4e6);
  vm.expectRevert(RefundReserve.DailyLimitExceeded.selector); reserve.refund(bytes32(uint256(3)), payer, 1e6);
  vm.warp(2 days); reserve.refund(bytes32(uint256(3)), payer, 1e6); vm.stopPrank();
  assertEq(token.balanceOf(payer), 11e6); assertEq(reserve.remainingDailyAllowance(), 9e6);
 }
 function testInsufficientBalanceKeepsEntitlementPending() public {
  register(order, 1e6); vm.prank(address(reserve)); token.transfer(address(0x55), 30e6);
  vm.expectRevert(); vm.prank(worker); reserve.refund(order, payer, 1e6);
  assertEq(reserve.remainingDailyAllowance(), 10e6);
  token.mint(address(reserve), 1e6); vm.prank(worker); reserve.refund(order, payer, 1e6);
  assertEq(token.balanceOf(payer), 1e6);
 }
 function testFuzzRefundCannotExceedAuthorizedAmount(uint96 amountSeed, uint96 excessSeed) public {
  uint256 amount = bound(amountSeed, 1, 10e6);
  uint256 excess = bound(excessSeed, 1, 10e6);
  register(order, amount);
  vm.expectRevert(RefundReserve.InvalidEntitlement.selector); vm.prank(worker); reserve.refund(order, payer, amount + excess);
  vm.prank(worker); reserve.refund(order, payer, amount);
  assertEq(token.balanceOf(payer), amount);
 }
 function testInvalidEntitlementsAndOverCapAmountsRejected() public {
  vm.startPrank(registrar);
  vm.expectRevert(RefundReserve.InvalidInput.selector); reserve.registerEntitlement(bytes32(0), payer, 1e6);
  vm.expectRevert(RefundReserve.InvalidInput.selector); reserve.registerEntitlement(order, address(0), 1e6);
  vm.expectRevert(RefundReserve.InvalidInput.selector); reserve.registerEntitlement(order, payer, 0);
  vm.expectRevert(RefundReserve.InvalidInput.selector); reserve.registerEntitlement(order, payer, 10e6 + 1);
  vm.stopPrank();
 }
}
