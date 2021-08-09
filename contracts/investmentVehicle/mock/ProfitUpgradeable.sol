// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
import "hardhat/console.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/math/SafeMathUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/math/MathUpgradeable.sol";

import "../../liquidate/external/IUniswapV2Router02.sol";
import "../InvestmentVehicleSingleAssetBaseV1Upgradeable.sol";

interface IMintableERC20 {
  function mint(address _account, uint256 _amount) external;
}

contract ProfitUpgradeable is InvestmentVehicleSingleAssetBaseV1Upgradeable {

    using SafeMathUpgradeable for uint256;
    using SafeERC20Upgradeable for IERC20Upgradeable;
    uint256 public pumpReward;

    function initialize(address _store, address _baseAsset) public override initializer {
      super.initialize(_store, _baseAsset);
      pumpReward = 10000;
    }

    /** Interacting with underlying investment opportunities */
    function _pullFundsFromInvestment(uint256 _amount) internal override{}

    function _investAll() internal override {}

    function setPumpReward(uint256 _amount) public {
      pumpReward = _amount;
    }

    function _collectProfitAsBaseAsset() internal override returns (uint256) {
      IMintableERC20(baseAsset).mint(address(this), pumpReward);
      return pumpReward;
    }

    /** View functions */

    function invested() public view override returns (uint256){
        return 0;
    }

    function profitsPending() public view override returns (uint256) {
        return 0;
    }
}