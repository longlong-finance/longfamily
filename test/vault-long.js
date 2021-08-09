var path = require('path');
if(process.env.RUNNING_COVERAGE == true) {
  var scriptName = path.basename(__filename);
  console.log("  Skipping " + scriptName);
  return ;
}

const TimelockProxy = artifacts.require("TimelockProxy");
const TimelockProxyStorageCentered = artifacts.require("TimelockProxyStorageCentered");
const TransferFromWhaleProfitUpgradeable = artifacts.require("TransferFromWhaleProfitUpgradeable");
const IERC20 = artifacts.require("IERC20");

const { BN, time, expectRevert, constants, send } = require('@openzeppelin/test-helpers');
const { assert } = require("chai");
const deploy = require("./helpers/deploy.js")
const {resetToBlock, impersonate} = require("./helpers/blockchain-helpers.js");

describe("IVSA basic", function(){

  let accounts;
  let admin;
  let proxyAdmin;
  let user;
  let assetAmount;

  let store;
  let vault;
  let ivProfit;
  let ivHodlImplementation;
  let ivProfitImplementation;

  let wethAddr = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
  let usdcAddr = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
  let weth;
  let usdc;
  let usdcWhale = "0x47ac0Fb4F2D84898e4D9E7b4DaB3C24507a6D503";
  let blockNo = 12500589;

  let vaultInitCall;

  before(async function() {
    await resetToBlock(blockNo);
    await impersonate([usdcWhale]);
    accounts = await web3.eth.getAccounts();
    admin = accounts[1];
    user = accounts[2];
    proxyAdmin = accounts[3];

    baseERC20 = await IERC20.at(usdcAddr);
    longERC20 = await IERC20.at(wethAddr);

    usdc = baseERC20;
    weth = longERC20;

    ivProfitImplementation = await TransferFromWhaleProfitUpgradeable.new();
    await send.ether(admin, usdcWhale, "10" + "0".repeat(18));
  });

  beforeEach(async function() {
    store = await deploy.store(admin, proxyAdmin);
    [vault, snx] = await deploy.vaultWithMsnx(store.address, baseERC20.address, longERC20.address, admin, proxyAdmin);
    await deploy.swapCenter(store, admin);

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
    }, [store.address, baseERC20.address]);

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
    assert.equal(1, await vault.investmentVehiclesLength());

    await ivProfit.addCreditor(
      vault.address,
      {from: admin}
    );
    assert.equal(await vault.isDebtor(ivProfit.address), true);

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

  describe("vault long asset", function() {

    it("Profit accounting for one creditor", async function() {
      await obtainAndDepsitIntoVault(user, usdc, usdcWhale, vault, assetAmount);
      await vault.investAll({from:admin});

      await ivProfit.collectProfitAndDistribute(0, {from: admin});

      // profit should be accounted to the vault in iv
      let vaultBalance = await ivProfit.baseAssetBalanceOf(vault.address);
      console.log(vaultBalance.toString());

      assert.equal(await weth.balanceOf(snx.address), "0");
      await vault.collectAndLong([ivProfit.address], 0, {from: admin});

      wethSentToPool = await weth.balanceOf(snx.address);
      assert.notEqual(wethSentToPool, "0");
    });


  });

});