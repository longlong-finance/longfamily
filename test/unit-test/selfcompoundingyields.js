const { deploy, obtainAndDepsitIntoVault,  equalBN, gtBN} = require("../helpers/helpers.js");

const TimelockProxyStorageCentered = artifacts.require("TimelockProxyStorageCentered");
const TransferFromWhaleProfitUpgradeable = artifacts.require("TransferFromWhaleProfitUpgradeable");
const IERC20 = artifacts.require("IERC20");
const MockERC20 = artifacts.require("MockERC20");
const SelfCompoundingYieldUpgradeable = artifacts.require("SelfCompoundingYieldUpgradeable");

const { BN, time, expectRevert, constants, send } = require('@openzeppelin/test-helpers');
const { assert } = require("chai");

describe("Self compounding standalone", function(){

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

  let baseERC20;

  before(async function() {
    accounts = await web3.eth.getAccounts();
    admin = accounts[1];
    user = accounts[2];
    proxyAdmin = accounts[3];
    assetGiver = accounts[4];

    baseERC20 = await MockERC20.new("base", "BASED");

    ivProfitImplementation = await TransferFromWhaleProfitUpgradeable.new();
  });

  beforeEach(async function() {
    store = await deploy.store(admin, proxyAdmin);
    scYield = await deploy.selfCompoundingYield(store.address, baseERC20.address, admin, proxyAdmin);
    // set exchange rate to 0.5. 2 base = 1 long

    let ivProfitProxy = await TimelockProxyStorageCentered.new(
      ivProfitImplementation.address, store.address,
      0, "0x", {from: admin}
    );

    ivProfit = await TransferFromWhaleProfitUpgradeable.at(ivProfitProxy.address);
    await ivProfit.initialize(store.address, baseERC20.address);

    await scYield.addInvestmentVehicle(
        ivProfit.address,// newVehicle,
        10000,// _lendMaxBps (10000 is not restricted)
        constants.MAX_UINT256,// _lendCap
        {from: admin}
    );

    await ivProfit.addCreditor(
        scYield.address,
        {from: admin}
    );

    assetAmount = "1000" + "0".repeat(18);
    await ivProfit.setPumpReward(assetAmount);

    // mint to the whale, so that it has enough assets for providing profit and market
    await baseERC20.mint(assetGiver, "10000000000" + "0".repeat(18));

    // whale provides the profit all the time.
    await ivProfit.setWhale(assetGiver);
    await baseERC20.approve(ivProfit.address, constants.MAX_UINT256, {from: assetGiver});
  });

  async function obtainAndDepsitIntoSCYield(_user, _baseAsset, _baseAssetWhale, _scYield, _assetAmount){
    await _baseAsset.transfer(_user, _assetAmount, {from: _baseAssetWhale})
    await _baseAsset.approve(_scYield.address, _assetAmount, {from: _user});
    await _scYield.deposit(_assetAmount, {from: _user});
  }

  describe("self compounding", function() {

    it("share price increases", async function() {
      // whitelist user
      await scYield.addWhitelistDeposit(user, {from: admin});
      await obtainAndDepsitIntoSCYield(user, baseERC20, assetGiver, scYield, assetAmount);

      // share price is now 1
      equalBN(await scYield.sharePrice(), "1" + "0".repeat(18));

      await scYield.investAll({from: admin});

      await ivProfit.setPumpReward(assetAmount);
      await ivProfit.collectProfitAndDistribute(0, {from: admin});

      // share price is now greater than 1
      gtBN(await scYield.sharePrice(), "1" + "0".repeat(18));
    });
  });

}); 