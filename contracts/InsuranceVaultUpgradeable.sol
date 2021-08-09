// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
import "hardhat/console.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/math/SafeMathUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/math/MathUpgradeable.sol";

import "@openzeppelin/contracts-upgradeable/utils/EnumerableSetUpgradeable.sol";

import "./interface/IDebtor.sol";
import "./interface/ISwap.sol";
import "./VaultUpgradeable.sol";
import "./investmentVehicle/InvestmentVehicleSingleAssetBaseV1Upgradeable.sol";

/**

*/
contract InsuranceVaultUpgradeable is VaultUpgradeable {
  using SafeERC20Upgradeable for IERC20Upgradeable;
  using SafeMathUpgradeable for uint256;
  using EnumerableSetUpgradeable for EnumerableSetUpgradeable.AddressSet;
  mapping(address => uint256) public claimAmount;
  uint256 constant public SHARE_UNIT = 1e18;
  uint256 public sharePrice;

  EnumerableSetUpgradeable.AddressSet insuredIV;

  event InsuranceClientAdded(address _iv);
  event InsuranceClientRemoved(address _iv);
  event ClaimFiled(address insuranceClient, uint256 amount);
  event ClaimProcessed(address indexed _iv, uint256 vaultBaseAmountIn, uint256 ivBaseAmountToTransfer, uint256 oldSharePrice, uint256 newSharePrice);
  event LongedInsurance(uint256 totalDeposit, uint256 longedProfit);

  modifier onlyInsuranceClient() {
    require(insuredIV.contains(msg.sender), "Not insurance client");
    _;
  }

  modifier insuranceTimelockPassed(address iv) {
    // if timelock registry is not set, then timelock is not yet activated.
    if(registry() != address(0)) { 
      if(ITimelockRegistryUpgradeable(registry()).vaultTimelockEnabled(address(this))) {  
        require(ITimelockRegistryUpgradeable(registry()).isIVInsuredByInsuranceVault(address(this), iv), "Vault: IV not available yet");
      }
    } 
    _;
  }

  function initialize(
      address _store,
      address _baseAsset,
      address _longAsset,
      uint256 _investmentCap
  ) public override initializer {
    super.initialize(_store, _baseAsset, _longAsset, _investmentCap);
    sharePrice = SHARE_UNIT;
  }

  function addInsuranceClient(address iv) public adminPriviledged insuranceTimelockPassed(iv) {
    address ivBaseAsset = InvestmentVehicleSingleAssetBaseV1Upgradeable(iv).baseAsset();
    require(ivBaseAsset != baseAsset, "iv baseAsset cannot be baseAsset");
    require(insuredIV.add(iv), "IV is already added in the insured set");
    emit InsuranceClientAdded(iv);
  }

  function removeInsuranceClient(address iv) public adminPriviledged {
    require(claimAmount[iv] == 0, "There are unresolved claims");
    require(insuredIV.remove(iv), "IV was not present in the set");
    emit InsuranceClientRemoved(iv);
  }

  function onGoingClaim() view public returns(bool haveClaim) {
    for(uint256 i = 0 ; i < insuredIV.length(); i++) {
      if(claimAmount[insuredIV.at(i)] > 0)
        return true;
    }
    return false;
  }

  // Note: Overriding the _deposit will make the `deposit` and `depositFor` in the VaultUpgradeable 
  // call this function. So we don't need to override `deposit` and `depositFor` in this contract.
  function _deposit(address assetFrom, address shareTo, uint256 amount) internal override {
    emit Deposit(shareTo, amount);
    IERC20Upgradeable(baseAsset).safeTransferFrom(
      assetFrom,
      address(this),
      amount
    );
    uint256 amountOfShare = amount.mul(SHARE_UNIT).div(sharePrice);
    _mint(shareTo, amountOfShare);
    _accountWithdrawFeeAtDeposit(shareTo, amount);
  }

  function withdraw(uint256 shareAmount) public override {
    require(!onGoingClaim(), "There are unresolved claims");
    uint256 amountToTransfer = shareAmount.mul(sharePrice).div(SHARE_UNIT);
    _withdrawSendwithFee(msg.sender, amountToTransfer);
    emit Withdraw(msg.sender, amountToTransfer);
    _burn(msg.sender, shareAmount);
  }

  function fileClaim(uint256 amount) public onlyInsuranceClient {
    claimAmount[msg.sender] = amount;
    emit ClaimFiled(msg.sender, amount);
  }

  function processClaim(address iv, uint256 vaultBaseAmountIn, uint256 ivBaseMinAmountOut) public onlyGovernance {
    require(insuredIV.contains(iv), "Not insurance client");
    require(claimAmount[iv] > 0, "there is no claim from iv");

    address ivBaseAsset = InvestmentVehicleSingleAssetBaseV1Upgradeable(iv).baseAsset();
    IERC20Upgradeable(baseAsset).safeApprove(swapCenter(), 0);
    IERC20Upgradeable(baseAsset).safeApprove(swapCenter(), vaultBaseAmountIn);
    ISwap(swapCenter()).swapExactTokenIn(baseAsset, ivBaseAsset, vaultBaseAmountIn, ivBaseMinAmountOut);
    uint256 ivBaseAmountOut = ERC20Upgradeable(ivBaseAsset).balanceOf(address(this));

    uint256 ivBaseAmountToTransfer = 0;
    if(ivBaseAmountOut > claimAmount[iv]) {
      ivBaseAmountToTransfer = claimAmount[iv];
      // Swap the residual back
      uint256 ivBaseResidual = ivBaseAmountOut - ivBaseAmountToTransfer;
      IERC20Upgradeable(ivBaseAsset).safeApprove(swapCenter(), 0);
      IERC20Upgradeable(ivBaseAsset).safeApprove(swapCenter(), ivBaseResidual);
      ISwap(swapCenter()).swapExactTokenIn(ivBaseAsset, baseAsset, ivBaseResidual, 0);
    } else {
      ivBaseAmountToTransfer = ivBaseAmountOut;
    }

    IERC20Upgradeable(ivBaseAsset).safeTransfer(iv, ivBaseAmountToTransfer);

    // Recalculate the insurance amount
    InvestmentVehicleSingleAssetBaseV1Upgradeable(iv).fileInsuanceClaim();

    // update shareprice
    // Assert: Insurance vault will not invest in any IV and will hold
    // all the vaultBaseAsset in the vault contract.
    uint256 oldSharePrice = sharePrice;
    sharePrice = IERC20Upgradeable(baseAsset).balanceOf(address(this)).mul(SHARE_UNIT).div(totalSupply());
    emit ClaimProcessed(iv, vaultBaseAmountIn, ivBaseAmountToTransfer, oldSharePrice, sharePrice);
  }

  function _investTo(address _target, uint256 _amount) internal override returns(uint256){
    revert("Insurance vault cannot invest");
  }

  function collectAndLong(address[] memory ivs, uint256 minimumLongProfit) public override opsPriviledged {

    for(uint256 i = 0; i < ivs.length; i++){
      address iv = ivs[i];

      uint256 ivBaseProfit = InvestmentVehicleSingleAssetBaseV1Upgradeable(iv).claimDividendAsBeneficiary();
      address ivBaseAsset = InvestmentVehicleSingleAssetBaseV1Upgradeable(iv).baseAsset();

      if(ivBaseAsset != longAsset) {
        IERC20Upgradeable(ivBaseAsset).safeApprove(swapCenter(), 0);
        IERC20Upgradeable(ivBaseAsset).safeApprove(swapCenter(), ivBaseProfit);
        ISwap(swapCenter()).swapExactTokenIn(ivBaseAsset, longAsset, ivBaseProfit, 0);
      }
    }

    uint256 longedProfit = IERC20Upgradeable(longAsset).balanceOf(address(this));
    require(longedProfit >= minimumLongProfit, "longed profit lower than expected.");
    _distributeProfit(longedProfit);
    uint256 totalDeposit = totalSupply().mul(sharePrice).div(SHARE_UNIT);
    emit LongedInsurance(totalDeposit, longedProfit);
  }

}
