// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {RefundReserve} from "../src/RefundReserve.sol";
import {TestUSDC} from "./RefundReserve.t.sol";
contract ReserveHandler is Test {
    RefundReserve public reserve;
    TestUSDC public token;
    address public constant PAYER = address(0x123);
    uint256 public count;
    uint256 public paid;
    mapping(uint256 => uint256) public observedSpend;
    constructor(RefundReserve r, TestUSDC t) { reserve = r; token = t; }
    function registerAndRefund(uint96 seed) external {
        uint256 amount = bound(seed, 1, 10e6);
        bytes32 id = bytes32(++count);
        vm.prank(address(0x11)); reserve.registerEntitlement(id, PAYER, amount);
        vm.prank(address(0x22));
        try reserve.refund(id, PAYER, amount) {
            paid += amount; observedSpend[block.timestamp / 1 days] += amount;
            // Replaying must never move more funds.
            vm.prank(address(0x22));
            try reserve.refund(id, PAYER, amount) { revert("replay accepted"); } catch {}
        } catch {}
    }
    function advance(uint32 secondsSeed) external { vm.warp(block.timestamp + bound(secondsSeed, 0, 2 days)); }
}
contract ReserveInvariantTest is StdInvariant, Test {
    RefundReserve reserve;
    TestUSDC token;
    ReserveHandler handler;
    function setUp() public {
        token = new TestUSDC();
        reserve = new RefundReserve(address(token), address(this), address(0x11), address(0x22));
        token.mint(address(reserve), 1000e6);
        handler = new ReserveHandler(reserve, token);
        targetContract(address(handler));
        bytes4[] memory selectors = new bytes4[](2);
        selectors[0] = handler.registerAndRefund.selector; selectors[1] = handler.advance.selector;
        targetSelector(FuzzSelector(address(handler), selectors));
    }
    function invariantFundsOnlyReachOriginalPayer() public view {
        assertEq(token.balanceOf(handler.PAYER()), handler.paid());
        assertEq(token.balanceOf(address(reserve)) + handler.paid(), 1000e6);
    }
    function invariantCalendarDayNeverOverspends() public view {
        uint256 day = block.timestamp / 1 days;
        assertLe(handler.observedSpend(day), 10e6);
        assertEq(reserve.dailySpent(day), handler.observedSpend(day));
    }
}
