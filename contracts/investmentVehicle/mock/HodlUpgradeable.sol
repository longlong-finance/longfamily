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

contract HodlUpgradeable is InvestmentVehicleSingleAssetBaseV1Upgradeable {

    using SafeMathUpgradeable for uint256;
    using SafeERC20Upgradeable for IERC20Upgradeable;

    /** Interacting with underlying investment opportunities */
    function _pullFundsFromInvestment(uint256 _amount) internal override{}

    function _investAll() internal override {}

    /** Collecting profits */
    function collectProfitAndDistribute(uint256 minBaseProfit) external override onlyGovernance {}


    function _collectProfitAsBaseAsset() internal override returns (uint256) {
        return 0;
    }

    /** View functions */

    function invested() public view override returns (uint256){
        return 0;
    }

    function profitsPending() public view override returns (uint256) {
        return 0;
    }
}