var path = require('path');
if(process.env.RUNNING_COVERAGE) {
  var scriptName = path.basename(__filename);
  console.log("  Skipping " + scriptName);
  return ;
}
const { resetToBlock, impersonate, deploy } = require("../helpers/helpers.js");

const TimelockProxy = artifacts.require("TimelockProxy");
const TimelockProxyStorageCentered = artifacts.require("TimelockProxyStorageCentered");
const VaultUpgradeable = artifacts.require("VaultUpgradeable");
const StorageV1Upgradeable = artifacts.require("StorageV1Upgradeable");
const SwapCenter = artifacts.require("SwapCenter");
const InsuranceVaultUpgradeable = artifacts.require("InsuranceVaultUpgradeable");
const IERC20 = artifacts.require("IERC20");
const TransferFromWhaleProfitUpgradeable = artifacts.require("TransferFromWhaleProfitUpgradeable");

const { BigNumber } = require('@ethersproject/bignumber');
const { time, expectRevert, constants, send, BN} = require('@openzeppelin/test-helpers');
const { assert } = require('chai');

describe("Insurance", function(){

  let accounts;
  let admin;
  let proxyAdmin;
  let user;
  let etherGiver;

  let store;
  let vault;
  let insuranceVault;
  let swapCenter;

  let ivProfit;
  let ivProfitImplementation;


  let sushiAddr = "0x6B3595068778DD592e39A122f4f5a5cF09C90fE2";
  let wethAddr = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
  let usdcAddr = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
  let sushi;
  let weth;
  let usdc;

  let sushiWhale = "0xe93381fb4c4f14bda253907b18fad305d799241a";
  let usdcWhale = "0x47ac0Fb4F2D84898e4D9E7b4DaB3C24507a6D503";
  let blockNo = 12500589;

  async function obtainAssetFor(target, whale, tokenAddress, amount) {
    await impersonate([whale]);
    let token = await IERC20.at(tokenAddress);
    await send.ether(etherGiver, whale, "1000000000000000000"); // 1ETH
    await token.transfer(target, amount, {from: whale});
  }

  before(async function() {
    await resetToBlock(blockNo);

    accounts = await web3.eth.getAccounts();
    admin = accounts[1];
    user = accounts[2];
    proxyAdmin = accounts[3];
    etherGiver = accounts[4];
    insuranceProvider = accounts[5];

    sushi = await IERC20.at(sushiAddr);
    weth = await IERC20.at(wethAddr);
    usdc = await IERC20.at(usdcAddr);
    ivProfitImplementation = await TransferFromWhaleProfitUpgradeable.new();
    await send.ether(admin, usdcWhale, "10" + "0".repeat(18));
  });

  beforeEach(async function() {

    store = await deploy.store(admin, proxyAdmin);
    swapCenter = await deploy.swapCenter(store, admin);

    await swapCenter.setRoute(
      sushi.address,
      usdc.address,
      [1, 0],
      [
        [sushi.address, weth.address],
        [weth.address, usdc.address]
      ], {from: admin}
    );

    await swapCenter.setRoute(
      usdc.address,
      sushi.address,
      [0, 1],
      [
        [usdc.address, weth.address],
        [weth.address, sushi.address]
      ], {from: admin}
    );

    [vault, snx] = await deploy.vaultWithMsnx(store.address, usdc.address, weth.address, admin, proxyAdmin);

    await store.setSwapCenter(swapCenter.address, {from: admin});

    [insuranceVault, insuranceSnx] = await deploy.insuranceVaultWithMsnx(store.address, sushi.address, usdc.address, admin, proxyAdmin);

    hodlInitCall = web3.eth.abi.encodeFunctionCall({
      name: 'initialize',
      type: 'function',
      inputs: [{
          type: 'address',
          name: 'storage'
      },{
          type: 'address',
          name: 'base'
      }]
    }, [store.address, usdc.address]);

    let ivProfitProxy = await TimelockProxyStorageCentered.new(
      ivProfitImplementation.address,
      store.address,
      0,    // no timelock
      hodlInitCall, // same init function as hodl
      {from: admin}
    );

    ivProfit = await TransferFromWhaleProfitUpgradeable.at(ivProfitProxy.address);

    await vault.addInvestmentVehicle(
      ivProfit.address,// newVehicle,
      10000,// _lendMaxBps (10000 is not restricted)
      constants.MAX_UINT256,// _lendCap
      {from: admin}
    );

    await ivProfit.addCreditor(vault.address, {from: admin});

    await insuranceVault.addInsuranceClient(ivProfit.address, {from: admin});
    await ivProfit.addBeneficiary(
      insuranceVault.address,
      5000, // 10,000 is 1 unit
      1, // ROLE_INSURER
      {from: admin}
    );

    // obtain usdc from usdc whale
    await obtainAssetFor(user, usdcWhale, usdc.address, "1000" + "000000");
    await obtainAssetFor(user, sushiWhale, sushi.address, "1" + "000000000000000000");


    assetAmount = "1000" + "0".repeat(6); // usdc has 6 decimal
    // set how much the strategy would gain when we call `collectProfitAndDistribute()`
    await ivProfit.setPumpReward(assetAmount);

    // whale provides the profit all the time.
    await ivProfit.setWhale(usdcWhale);
    await usdc.approve(ivProfit.address, constants.MAX_UINT256, {from: usdcWhale});
  });

  async function obtainAndDepsitIntoVault(_user, _baseAsset, _baseAssetWhale, _vault, _assetAmount){
    await _baseAsset.transfer(_user, _assetAmount, {from: _baseAssetWhale})
    await _baseAsset.approve(_vault.address, _assetAmount, {from: _user});
    await _vault.deposit(_assetAmount, {from: _user});
  }

  describe("getting dividend", function() {
    it("getting dividend from one IV", async function(){
      let usdcAmount = "1" + "000000";
      let sushiAmount = "1" + "000000000000000000";

      await obtainAndDepsitIntoVault(insuranceProvider, sushi, sushiWhale, insuranceVault, sushiAmount);
      await obtainAndDepsitIntoVault(user, usdc, usdcWhale, vault, usdcAmount);

      await vault.investAll({from: admin});
      assert.equal(await usdc.balanceOf(ivProfit.address), usdcAmount);

      await ivProfit.collectProfitAndDistribute(0, {from: admin});

      // profit should be accounted to the vault in iv
      let vaultBalance = await ivProfit.baseAssetBalanceOf(vault.address);
      console.log(vaultBalance.toString());
      let insuranceVaultPSInfo = await ivProfit.psInfo(insuranceVault.address);
      let dividend = insuranceVaultPSInfo.profit;
      console.log(dividend.toString());

      assert.equal(await weth.balanceOf(snx.address), "0");
      await vault.collectAndLong([ivProfit.address], 0, {from: admin});

      wethSentToPool = await weth.balanceOf(snx.address);
      assert.notEqual(wethSentToPool, "0");


      assert.equal(await usdc.balanceOf(insuranceSnx.address), "0");
      await insuranceVault.collectAndLong([ivProfit.address], 0, {from: admin});
      usdcSentToPool = await usdc.balanceOf(insuranceSnx.address);
      assert.notEqual(usdcSentToPool, "0");
    });



  });

});
