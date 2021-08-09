const { deploy, obtainAndDepsitIntoVault } = require("../helpers/helpers.js");

const TimelockProxy = artifacts.require("TimelockProxy");
const TransferFromWhaleProfitUpgradeable = artifacts.require("TransferFromWhaleProfitUpgradeable");
const IERC20 = artifacts.require("IERC20");
const MockSwapCenter = artifacts.require("MockSwapCenter");
const MockERC20 = artifacts.require("MockERC20");
const TimelockProxyStorageCentered = artifacts.require("TimelockProxyStorageCentered");
const { BN, time, expectRevert, constants, send } = require('@openzeppelin/test-helpers');
const { assert } = require("chai");

describe("Vault long basic", function(){

  let accounts;
  let admin;
  let proxyAdmin;
  let user;
  let assetGiver;
  let assetAmount;

  let store;
  let vault;
  let ivProfit;
  let ivProfitImplementation;
  let swapCenter;

  let baseERC20;
  let longERC20;

  before(async function() {
    accounts = await web3.eth.getAccounts();
    admin = accounts[1];
    user = accounts[2];
    proxyAdmin = accounts[3];
    assetGiver = accounts[4];

    baseERC20 = await MockERC20.new("base", "BASED");
    longERC20 = await MockERC20.new("long", "LONGED");

    ivProfitImplementation = await TransferFromWhaleProfitUpgradeable.new();
  });

  async function deployMockSwapCenter(_store, _assetGiver) {
    let deployedSwapCenter = await MockSwapCenter.new();
    await _store.setSwapCenter(deployedSwapCenter.address, {from: admin});
    await deployedSwapCenter.setWhale(_assetGiver);
    return deployedSwapCenter;
  }

  beforeEach(async function() {
    store = await deploy.store(admin, proxyAdmin);
    [vault, snx] = await deploy.vaultWithMsnx(store.address, baseERC20.address, longERC20.address, admin, proxyAdmin);
    swapCenter = await deployMockSwapCenter(store, assetGiver);
    // set exchange rate to 0.5. 2 base = 1 long
    await swapCenter.setExchangeRate(baseERC20.address, longERC20.address, 5000);

    let ivProfitProxy = await TimelockProxyStorageCentered.new(
      ivProfitImplementation.address, store.address,
      0, "0x", {from: admin}
    );

    ivProfit = await TransferFromWhaleProfitUpgradeable.at(ivProfitProxy.address);
    await ivProfit.initialize(store.address, baseERC20.address);

    await vault.addInvestmentVehicle(
      ivProfit.address,// newVehicle,
        10000,// _lendMaxBps (10000 is not restricted)
        constants.MAX_UINT256,// _lendCap
        {from: admin}
    );

    await ivProfit.addCreditor(
      vault.address,
      {from: admin}
    );

    assetAmount = "1000" + "0".repeat(18);
    await ivProfit.setPumpReward(assetAmount);

    // mint to the whale, so that it has enough assets for providing profit and market
    await baseERC20.mint(assetGiver, "10000000000" + "0".repeat(18));
    await longERC20.mint(assetGiver, "10000000000" + "0".repeat(18));

    // whale provides the profit all the time.
    await ivProfit.setWhale(assetGiver);
    await baseERC20.approve(ivProfit.address, constants.MAX_UINT256, {from: assetGiver});
    // whale provides the profit all the time.
    await longERC20.approve(swapCenter.address, constants.MAX_UINT256, {from: assetGiver});
  });

  async function obtainAndDepsitIntoVault(_user, _baseAsset, _baseAssetWhale, _vault, _assetAmount){
    await _baseAsset.transfer(_user, _assetAmount, {from: _baseAssetWhale})
    await _baseAsset.approve(_vault.address, _assetAmount, {from: _user});
    await _vault.deposit(_assetAmount, {from: _user});
  }

  describe("vault long asset", function() {

    it("Profit accounting for one creditor", async function() {
      await obtainAndDepsitIntoVault(user, baseERC20, assetGiver, vault, assetAmount);
      await vault.investAll({from:admin});

      await ivProfit.collectProfitAndDistribute(0, {from: admin});

      // profit should be accounted to the vault in iv
      let vaultBalance = await ivProfit.baseAssetBalanceOf(vault.address);
      console.log(vaultBalance.toString());

      assert.equal(await longERC20.balanceOf(snx.address), "0");
      await vault.collectAndLong([ivProfit.address], 0, {from: admin});

      longSentToPool = await longERC20.balanceOf(snx.address);
      assert.notEqual(longSentToPool, "0");
      assert.equal(longSentToPool, "500" + "0".repeat(18));
    });


  });

});