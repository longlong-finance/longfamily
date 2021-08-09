// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../../interface/ISwap.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "hardhat/console.sol";

contract MockSwapCenter is ISwap {

  address public whale;
  uint256 constant public rateBase = 10000;
  mapping(address => mapping(address => uint256)) public exchangeRate;

  function setExchangeRate(address _from, address _to, uint256 _exchangeRate) public {
    exchangeRate[_from][_to] = _exchangeRate;
  }

  function setWhale(address _whale) public {
    whale = _whale;
  }

  // mock so no need for SafeMath and SafeERC20
  function swapExactTokenIn(address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut) external payable override returns (uint256) {
    require(exchangeRate[tokenIn][tokenOut] != 0, "exchange rate not set");
    IERC20Upgradeable(tokenIn).transferFrom(msg.sender, address(this), amountIn);
    uint256 rate = exchangeRate[tokenIn][tokenOut];
    uint256 amountOut = amountIn * rate / rateBase;
    require(minAmountOut <= amountOut, "minAmountOut not reached");
    IERC20Upgradeable(tokenOut).transferFrom(whale, msg.sender, amountOut);
    return amountOut;
  }
}