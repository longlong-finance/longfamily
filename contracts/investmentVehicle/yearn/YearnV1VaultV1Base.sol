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
import "./interface/IYearnVault.sol";


contract YearnV1VaultV1Base is InvestmentVehicleSingleAssetBaseV1Upgradeable {

    using SafeMathUpgradeable for uint256;
    using SafeERC20Upgradeable for IERC20Upgradeable;


    // Liquidation
    address public constant weth = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    address public constant uniswapV2Router = 0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D;

    address public yearnVault;

    function initialize(
        address _store,
        address _baseAsset,
        address _yVault
    ) public initializer {
        super.initialize(_store, _baseAsset);
        yearnVault = _yVault;
    }

    function baseAssetToShares(uint256 baseAssetAmount) public view returns(uint256) {
        // Harvest uses the unit of the baseAsset to calculate the share price.
        return baseAssetAmount
            .mul(10 ** 18)
            .div(IYearnVault(yearnVault).getPricePerFullShare());
    }

    function sharesToBaseAsset(uint256 shares) public view returns(uint256) {
         // Harvest uses the unit of the baseAsset to calculate the share price.
        return shares
            .mul(IYearnVault(yearnVault).getPricePerFullShare())
            .div(10 ** 18);
    }

    /** Interacting with underlying investment opportunities */
    function _pullFundsFromInvestment(uint256 _amount) internal override{
        uint256 respectiveShare = baseAssetToShares(_amount);

        // Unstake from reward pool
        uint256 ownedShare = IYearnVault(yearnVault).balanceOf(address(this));
        uint256 withdrawingShare = MathUpgradeable.min(ownedShare, respectiveShare);

        IYearnVault(yearnVault).withdraw(withdrawingShare);
    }

    function _investAll() internal override {
        uint256 baseAssetAmountInVehicle = IERC20Upgradeable(baseAsset).balanceOf(address(this));
        // Approve yearn harvest vault
        IERC20Upgradeable(baseAsset).safeApprove(yearnVault, 0);
        IERC20Upgradeable(baseAsset).safeApprove(yearnVault, baseAssetAmountInVehicle);
        // Deposit to yearn vault
        IYearnVault(yearnVault).deposit(baseAssetAmountInVehicle);

    }

    function _collectProfitAsBaseAsset() internal override returns (uint256) {
        return profitsPending();
    }

    /** View functions */

    function totalYearnVaultShares() public view returns (uint256 totalShares) {
        totalShares = IERC20Upgradeable(yearnVault).balanceOf(address(this));
    }

    function invested() public view override returns (uint256){
        return sharesToBaseAsset(totalYearnVaultShares());
    }

    function profitsPending() public view override returns (uint256) {
        uint256 ivBalance = IERC20Upgradeable(baseAsset).balanceOf(address(this));

        uint256 yvaultBalance = invested();

        uint256 totalBalance = ivBalance.add(yvaultBalance);

        uint256 profit = totalBalance.sub(totalDebt());


        return profit;
    }
}