const TimelockProxy = artifacts.require("TimelockProxy");
const VaultUpgradeable = artifacts.require("VaultUpgradeable");
const StorageV1Upgradeable = artifacts.require("StorageV1Upgradeable");
const MockERC20 = artifacts.require("MockERC20");
const SwapCenter = artifacts.require("SwapCenter");
const InsuranceVaultUpgradeable = artifacts.require("InsuranceVaultUpgradeable");

async function obtainAndDepsitIntoVault(_user, _baseAsset, _baseAssetWhale, _vault, _assetAmount){
  await _baseAsset.transfer(_user, _assetAmount, {from: _baseAssetWhale})
  await _baseAsset.approve(_vault.address, _assetAmount, {from: _user});
  await _vault.deposit(_assetAmount, {from: _user});
}

module.exports = {
  obtainAndDepsitIntoVault,
};