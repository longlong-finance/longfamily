var path = require('path');
if(process.env.RUNNING_COVERAGE) {
  var scriptName = path.basename(__filename);
  console.log("  Skipping " + scriptName);
  return ;
}
const { resetToBlock, impersonate, deploy, equalBN, approxBN, ltBN } = require("../helpers/helpers.js");

const TimelockProxy = artifacts.require("TimelockProxy");
const TimelockProxyStorageCentered = artifacts.require("TimelockProxyStorageCentered");
const VaultUpgradeable = artifacts.require("VaultUpgradeable");
const StorageV1Upgradeable = artifacts.require("StorageV1Upgradeable");
const SwapCenter = artifacts.require("SwapCenter");
const InsuranceVaultUpgradeable = artifacts.require("InsuranceVaultUpgradeable");
const IERC20 = artifacts.require("IERC20");
const RugUpgradeable = artifacts.require("RugUpgradeable");

const { BigNumber } = require('@ethersproject/bignumber');
const { time, expectRevert, constants, send, BN} = require('@openzeppelin/test-helpers');
const { assert, expect } = require('chai');

describe("Insurance", function(){

  let accounts;
  let admin;
  let proxyAdmin;
  let user;
  let etherGiver;

  let store;
  let vault;
  let vaultImplmentation;
  let insuranceVault;
  let swapCenter;
  let insuranceVaultImplementation;

  let rugIvImplementation;
  let rugIv;

  let sushiAddr = "0x6B3595068778DD592e39A122f4f5a5cF09C90fE2";
  let wethAddr = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
  let usdcAddr = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
  let sushi;
  let weth;
  let usdc;

  let blockNo = 12219910;
  let usdcWhale = "0x47ac0fb4f2d84898e4d9e7b4dab3c24507a6d503";
  let sushiWhale = "0xe93381fb4c4f14bda253907b18fad305d799241a";

  let SHARE_UNIT = "1" + "0".repeat(18);

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

    swapCenter = await SwapCenter.new({from: admin});
    ivRugImplementation = await RugUpgradeable.new();

    sushi = await IERC20.at(sushiAddr);
    weth = await IERC20.at(wethAddr);
    usdc = await IERC20.at(usdcAddr);
  });

  beforeEach(async function() {

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

    store = await deploy.store(admin, proxyAdmin);
    [vault, snx] = await deploy.vaultWithMsnx(store.address, usdc.address, weth.address, admin, proxyAdmin);

    await store.setSwapCenter(swapCenter.address, {from: admin});

    [insuranceVault, insuranceSnx] = await deploy.insuranceVaultWithMsnx(store.address, sushi.address, usdc.address, admin, proxyAdmin);

    ivInitCall = web3.eth.abi.encodeFunctionCall({
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

    let ivRugProxy = await TimelockProxyStorageCentered.new(
      ivRugImplementation.address,
      store.address,
      0,    // no timelock
      ivInitCall, // same init function as hodl
      {from: admin}
    );

    ivRug = await RugUpgradeable.at(ivRugProxy.address);

    await vault.addInvestmentVehicle(
      ivRug.address,// newVehicle,
      10000,// _lendMaxBps (10000 is not restricted)
      constants.MAX_UINT256,// _lendCap
      {from: admin}
    );

    await ivRug.addCreditor(vault.address, {from: admin});

    await insuranceVault.addInsuranceClient(ivRug.address, {from: admin});
    await ivRug.addBeneficiary(
      insuranceVault.address,
      5000, // 10,000 is 1 unit
      1, // ROLE_INSURER
      {from: admin}
    );

    // obtain usdc from usdc whale
    await obtainAssetFor(user, usdcWhale, usdc.address, "1000" + "000000");
    await obtainAssetFor(user, sushiWhale, sushi.address, "1" + "000000000000000000");
  });

  describe("Process claim", function() {
    it("completely repaid", async function(){
      let usdcAmount = "1" + "000000";
      let sushiAmount = "1" + "000000000000000000";

      await sushi.approve(insuranceVault.address, sushiAmount, {from: user});
      await insuranceVault.deposit(sushiAmount, {from: user});
      assert.equal(await insuranceVault.onGoingClaim(), false);
      await ivRug.fileInsuanceClaim({from: admin});
      assert.equal(await insuranceVault.onGoingClaim(), false);


      await usdc.approve(vault.address, usdcAmount, {from: user});
      await vault.deposit(usdcAmount, {from: user});
      assert.equal(await usdc.balanceOf(ivRug.address), 0);
      await vault.investAll({from: admin});
      assert.equal(await usdc.balanceOf(ivRug.address), usdcAmount);

      // ivRug rugged
      await ivRug.rugPull(usdcAmount);
      assert.equal(await usdc.balanceOf(ivRug.address), 0);

      // file claim
      assert.equal(await insuranceVault.onGoingClaim(), false);
      await ivRug.fileInsuanceClaim({from: admin});

      //  cannot withdraw from insuranceVault
      assert.equal(await insuranceVault.onGoingClaim(), true);
      await expectRevert(insuranceVault.withdraw("1", {from: user}), "There are unresolved claim");
      equalBN(await insuranceVault.sharePrice(), SHARE_UNIT);

      await insuranceVault.processClaim(
        ivRug.address, sushiAmount, 0,
        {from: admin}
      );

      assert.equal((await insuranceVault.claimAmount(ivRug.address)).toString(), "0");
      assert.equal(await insuranceVault.onGoingClaim(), false);
      assert.equal(await usdc.balanceOf(ivRug.address), usdcAmount);
      assert.equal(
        (await sushi.balanceOf(insuranceVault.address)).gt(new BN("0")),
        true
      );
      ltBN(await insuranceVault.sharePrice(), SHARE_UNIT);

      assert.equal(await sushi.balanceOf(user), "0");
      await insuranceVault.withdraw(sushiAmount, {from: user});
      ltBN("0", await sushi.balanceOf(user));
      ltBN(await sushi.balanceOf(user), sushiAmount);
    });

    it("not enough collateral", async function(){
      let usdcAmount = "1000" + "000000";
      let sushiAmount = "1" + "000000000000000000";

      await sushi.approve(insuranceVault.address, sushiAmount, {from: user});
      await insuranceVault.deposit(sushiAmount, {from: user});
      assert.equal(await insuranceVault.onGoingClaim(), false);
      await ivRug.fileInsuanceClaim({from: admin});
      assert.equal(await insuranceVault.onGoingClaim(), false);


      await usdc.approve(vault.address, usdcAmount, {from: user});
      await vault.deposit(usdcAmount, {from: user});
      assert.equal(await usdc.balanceOf(ivRug.address), 0);
      await vault.investAll({from: admin});
      assert.equal(await usdc.balanceOf(ivRug.address), usdcAmount);

      // ivRug rugged
      await ivRug.rugPull(usdcAmount);
      assert.equal(await usdc.balanceOf(ivRug.address), 0);

      // file claim
      assert.equal(await insuranceVault.onGoingClaim(), false);
      await ivRug.fileInsuanceClaim({from: admin});

      //  cannot withdraw from insuranceVault
      assert.equal(await insuranceVault.onGoingClaim(), true);

      let claimAmountBefore = await insuranceVault.claimAmount(ivRug.address);
      await insuranceVault.processClaim(
        ivRug.address, sushiAmount, 0,
        {from: admin}
      );
      let claimAmountAfter = await insuranceVault.claimAmount(ivRug.address);

      equalBN(await insuranceVault.sharePrice(), "0");

      assert(
        claimAmountBefore.gt(claimAmountAfter),
      );

      assert.notEqual((await insuranceVault.claimAmount(ivRug.address)).toString(), "0");
      assert.equal(await insuranceVault.onGoingClaim(), true);
 
      assert((await usdc.balanceOf(ivRug.address)).gt(new BN("0")) );
      assert.equal(
        (await sushi.balanceOf(insuranceVault.address)), "0"
      );
      await expectRevert(insuranceVault.withdraw("1", {from: user}), "There are unresolved claim");
    });

  });

});
