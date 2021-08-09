const { deploy } = require("../helpers/helpers.js");

const TimelockProxy = artifacts.require("TimelockProxy");
const HodlUpgradeable = artifacts.require("HodlUpgradeable");
const ProfitUpgradeable = artifacts.require("ProfitUpgradeable");
const MockERC20 = artifacts.require("MockERC20");
const TimelockProxyStorageCentered = artifacts.require("TimelockProxyStorageCentered");
const { BN, time, expectRevert, constants } = require('@openzeppelin/test-helpers');
const { assert } = require("chai");

describe("IVSA basic", function(){

  let accounts;
  let admin;
  let proxyAdmin;
  let user;
  let assetAmount;

  let store;
  let vault;
  let baseERC20;
  let longERC20;
  let ivHodl;
  let ivProfit;
  let ivHodlImplementation;
  let ivProfitImplementation;

  before(async function() {
    accounts = await web3.eth.getAccounts();
    admin = accounts[1];
    user = accounts[2];
    proxyAdmin = accounts[3];

    ivHodlImplementation = await HodlUpgradeable.new();
    ivProfitImplementation = await ProfitUpgradeable.new();
  });

  beforeEach(async function() {
    baseERC20 = await MockERC20.new("base", "BASED");
    longERC20 = await MockERC20.new("long", "LONGED");
    store = await deploy.store(admin, proxyAdmin);
    [vault, snx] = await deploy.vaultWithMsnx(store.address, baseERC20.address, longERC20.address, admin, proxyAdmin);

    assert.equal(0, await vault.investmentVehiclesLength());

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

    let ivHodlProxy = await TimelockProxyStorageCentered.new(
      ivHodlImplementation.address,
      store.address,
      0,    // no timelock
      hodlInitCall,
      {from: admin}
    );

    ivHodl = await HodlUpgradeable.at(ivHodlProxy.address);

    let ivProfitProxy = await TimelockProxyStorageCentered.new(
      ivProfitImplementation.address,
      store.address,
      0,    // no timelock
      hodlInitCall, // same init function as hodl
      {from: admin}
    );

    ivProfit = await ProfitUpgradeable.at(ivProfitProxy.address);

    await vault.addInvestmentVehicle(
        ivHodl.address,// newVehicle,
        10000,// _lendMaxBps (10000 is not restricted)
        constants.MAX_UINT256,// _lendCap
        {from: admin}
    );
    assert.equal(1, await vault.investmentVehiclesLength());

    await ivHodl.addCreditor(
      vault.address,
      {from: admin}
    );

    assetAmount = "1000000";
    await baseERC20.mint(user, assetAmount);
  });

  describe("ivsa basic test", function() {

    it("Vault cannot add iv at anytime when timelockRegistry is enabled", async function(){
      timelock = await deploy.timelockRegistry(store.address, admin, proxyAdmin);
      await timelock.changeTimelockDelay("86400", {from: admin});
      await timelock.enableVaultTimelock(vault.address, {from: admin});
      await time.increase(86400);

      await expectRevert(vault.addInvestmentVehicle(
          ivProfit.address,// newVehicle,
          10000,// _lendMaxBps (10000 is not restricted)
          constants.MAX_UINT256,// _lendCap
          {from: admin}
      ), "Vault: IV not available yet");

      await timelock.announceIVForVault(vault.address, ivProfit.address, {from: admin});

      await expectRevert(vault.addInvestmentVehicle(
        ivProfit.address,// newVehicle,
        10000,// _lendMaxBps (10000 is not restricted)
        constants.MAX_UINT256,// _lendCap
        {from: admin}
      ), "Vault: IV not available yet");

      await time.increase(86400);

      await vault.addInvestmentVehicle(
        ivProfit.address,// newVehicle,
        10000,// _lendMaxBps (10000 is not restricted)
        constants.MAX_UINT256,// _lendCap
        {from: admin}
      )
    });

    it("User deposits and withdraws (funds pushed into vehicle and then withdrawn)", async function(){
      await baseERC20.approve(vault.address, assetAmount, {from: user});
      await vault.deposit(assetAmount, {from: user});
      assert.equal((await baseERC20.balanceOf(user)).toString(), "0");

      // pass 4 week so that there's no fee
      await time.increase(86400 * 7 * 4);

      // push funds into the first vehicle
      await vault.investAll({from:admin});
      assert.equal(await baseERC20.balanceOf(vault.address), "0");
      assert.equal(await baseERC20.balanceOf(ivHodl.address), assetAmount);
      let vaultBalance = await ivHodl.baseAssetBalanceOf(vault.address);
      assert.equal(vaultBalance, assetAmount);

      await vault.withdraw(assetAmount, {from: user});
      assert.equal(await baseERC20.balanceOf(vault.address), "0");
      assert.equal((await baseERC20.balanceOf(user)).toString(), assetAmount);
      vaultBalance = await ivHodl.baseAssetBalanceOf(vault.address);
      assert.equal(vaultBalance, "0");
    });

    it("After removal from IV, the vault can no longer deposit new funds but still be able to withdraw the existing funds.", async function(){
      let halfAssetAmount = "500000";
      await baseERC20.approve(vault.address, halfAssetAmount, {from: user});
      await vault.deposit(halfAssetAmount, {from: user});
      await vault.investAll({from:admin});
      
      assert.equal(await ivHodl.activeCreditor(vault.address), true);

      // Remove the vault from IV.
      await ivHodl.removeVault(vault.address, {from: admin});
      assert.equal(await ivHodl.activeCreditor(vault.address), false);

      // Cannot deposit new funds.
      await baseERC20.approve(vault.address, halfAssetAmount, {from: user});
      await vault.deposit(halfAssetAmount, {from: user});
      assert.equal(await ivHodl.baseAssetBalanceOf(vault.address), halfAssetAmount);
      expectRevert(
        vault.investAll({from:admin}),
        "IVSABU: msg.sender is not a creditor"
      );
      assert.equal(await ivHodl.baseAssetBalanceOf(vault.address), halfAssetAmount);

      // The vault can still withdraw the deposited funds from IV.
      await vault.withdrawAllFromIV(ivHodl.address, {from: admin});
      // balance should be 0
      assert.equal(await ivHodl.baseAssetBalanceOf(vault.address), "0");
    });

    it("Vault can remove vehicle", async function() {
      assert.equal(1, await vault.investmentVehiclesLength());
      await vault.removeInvestmentVehicle(ivHodl.address, {from: admin});
      assert.equal(0, await vault.investmentVehiclesLength());
    });

    it("Profit accounting for one creditor", async function() {
      await vault.addInvestmentVehicle(
        ivProfit.address,// newVehicle,
        10000,// _lendMaxBps (10000 is not restricted)
        constants.MAX_UINT256,// _lendCap
        {from: admin}
      );

      // remove the hodl, now all it's left is the ivProfit
      await vault.removeInvestmentVehicle(ivHodl.address, {from: admin});

      assert.equal(await vault.isDebtor(ivProfit.address), true);
      assert.equal(await vault.isDebtor(ivHodl.address), false);

      await ivProfit.addCreditor(
        vault.address,
        {from: admin}
      );

      await baseERC20.approve(vault.address, assetAmount, {from: user});
      await vault.deposit(assetAmount, {from: user});
      await vault.investAll({from:admin});
      assert.equal(await ivProfit.baseAssetBalanceOf(vault.address), assetAmount);
      assert.equal(await baseERC20.balanceOf(ivProfit.address), assetAmount);

      // set how much the strategy would gain when we call `collectProfitAndDistribute()`
      await ivProfit.setPumpReward(assetAmount);
      // The balance is still the same because the profit hasn't been distributed.
      assert.equal((await ivProfit.baseAssetBalanceOf(vault.address)).toString(),
                    assetAmount.toString());

      let initialSharePrice = await ivProfit.sharePrice();
      let shareUnit = await ivProfit.SHARE_UNIT();
      assert.equal(initialSharePrice.toString(), shareUnit.toString());


      let afterProfitAmount = (new BN(assetAmount)).mul(new BN(2));
      await ivProfit.collectProfitAndDistribute(0, {from: admin});
      let afterSharePrice = await ivProfit.sharePrice();

      // The sharePrice should be doubled.
      assert.equal(initialSharePrice.mul(new BN(2)).toString(),
                   afterSharePrice.toString());

      // profit actually happened.
      assert.equal((await baseERC20.balanceOf(ivProfit.address)).toString(), afterProfitAmount.toString());

      // profit should be accounted to the vault in iv
      let vaultBalance = await ivProfit.baseAssetBalanceOf(vault.address);
      assert.equal(vaultBalance.toString(), afterProfitAmount.toString());

      // Withdraw from the IV.
      await vault.withdrawAllFromIV(ivProfit.address, {from: admin});
      assert.equal(await baseERC20.balanceOf(vault.address), assetAmount);
      // After withdraw, IV doesn't own vault any debt.
      assert.equal((await vault.baseAssetDebtOf(ivProfit.address)).toString(), "0");
      // The rest is the profit amount.
      assert.equal(await ivProfit.baseAssetBalanceOf(vault.address),
                   afterProfitAmount - assetAmount);
    });

    it("Profit accounting for two creditors", async function() {
      [vault2, snx2] = await deploy.vaultWithMsnx(store.address, baseERC20.address, longERC20.address, admin, proxyAdmin);

      await vault.addInvestmentVehicle(
        ivProfit.address,// newVehicle,
        10000,// _lendMaxBps (10000 is not restricted)
        constants.MAX_UINT256,// _lendCap
        {from: admin}
      );

      await vault2.addInvestmentVehicle(
        ivProfit.address,// newVehicle,
        10000,// _lendMaxBps (10000 is not restricted)
        constants.MAX_UINT256,// _lendCap
        {from: admin}
      );

      // remove the hodl, now all it's left is the ivProfit
      await vault.removeInvestmentVehicle(ivHodl.address, {from: admin});

      assert.equal(await vault.isDebtor(ivProfit.address), true);
      assert.equal(await vault.isDebtor(ivHodl.address), false);

      await ivProfit.addCreditor(
        vault.address,
        {from: admin}
      );

      await ivProfit.addCreditor(
        vault2.address,
        {from: admin}
      );

      await baseERC20.approve(vault.address, assetAmount, {from: user});
      await vault.deposit(assetAmount, {from: user});
      await vault.investAll({from:admin});
      assert.equal(await baseERC20.balanceOf(ivProfit.address), assetAmount);

      await baseERC20.mint(user, assetAmount);
      await baseERC20.approve(vault2.address, assetAmount, {from: user});
      await vault2.deposit(assetAmount, {from: user});
      await vault2.investAll({from:admin});
      assert.equal(await baseERC20.balanceOf(ivProfit.address), (new BN(assetAmount)).mul(new BN(2)).toString());

      // set how much the strategy would gain when we call `collectProfitAndDistribute()`
      await ivProfit.setPumpReward(assetAmount);

      let afterProfitAmount = (new BN(assetAmount)).mul(new BN(4));
      await ivProfit.collectProfitAndDistribute(0, {from: admin});
      await ivProfit.collectProfitAndDistribute(0, {from: admin});

      // profit actually happened.
      assert.equal((await baseERC20.balanceOf(ivProfit.address)).toString(), afterProfitAmount.toString());

      // profit should be accounted to the vault in iv
      let vaultBalance = await ivProfit.baseAssetBalanceOf(vault.address);
      assert.equal(vaultBalance.toString(), afterProfitAmount.div(new BN(2)).toString());
      let vaultBalance2 = await ivProfit.baseAssetBalanceOf(vault2.address);
      assert.equal(vaultBalance2.toString(), afterProfitAmount.div(new BN(2)).toString());

    });

    it("Profit accounting for two creditors (Second vault doesn't invest in the begining.)", async function() {
      [vault2, snx2] = await deploy.vaultWithMsnx(store.address, baseERC20.address, longERC20.address, admin, proxyAdmin);

      await vault.addInvestmentVehicle(
        ivProfit.address,// newVehicle,
        10000,// _lendMaxBps (10000 is not restricted)
        constants.MAX_UINT256,// _lendCap
        {from: admin}
      );

      await vault2.addInvestmentVehicle(
        ivProfit.address,// newVehicle,
        10000,// _lendMaxBps (10000 is not restricted)
        constants.MAX_UINT256,// _lendCap
        {from: admin}
      );

      // remove the hodl, now all it's left is the ivProfit
      await vault.removeInvestmentVehicle(ivHodl.address, {from: admin});

      assert.equal(await vault.isDebtor(ivProfit.address), true);
      assert.equal(await vault.isDebtor(ivHodl.address), false);

      await ivProfit.addCreditor(
        vault.address,
        {from: admin}
      );

      await ivProfit.addCreditor(
        vault2.address,
        {from: admin}
      );

      await baseERC20.approve(vault.address, assetAmount, {from: user});
      await vault.deposit(assetAmount, {from: user});
      await vault.investAll({from:admin});
      assert.equal(await baseERC20.balanceOf(ivProfit.address), assetAmount);

      await baseERC20.mint(user, assetAmount);
      await baseERC20.approve(vault2.address, assetAmount, {from: user});
      await vault2.deposit(assetAmount, {from: user});
      // Vault2 hasn't invested IV yet

      //await vault2.investAll({from:admin});
      //assert.equal(await baseERC20.balanceOf(ivProfit.address), (new BN(assetAmount)).mul(new BN(2)).toString());

      // set how much the strategy would gain when we call `collectProfitAndDistribute()`
      await ivProfit.setPumpReward(assetAmount);

      let afterProfitAmount = (new BN(assetAmount)).mul(new BN(6));
      await ivProfit.collectProfitAndDistribute(0, {from: admin});

      await vault2.investAll({from:admin});
      //await vault2.withdrawAllFromIV(ivProfit.address, {from: admin});
      //await vault2.investAll({from:admin});

      await ivProfit.collectProfitAndDistribute(0, {from: admin});
      await ivProfit.collectProfitAndDistribute(0, {from: admin});
      await ivProfit.collectProfitAndDistribute(0, {from: admin});

      // profit actually happened.
      assert.equal((await baseERC20.balanceOf(ivProfit.address)).toString(), afterProfitAmount.toString());

      // profit should be accounted to the vault in IV
      // Use assert.approximately to account for numerical error.
      let vaultBalance = await ivProfit.baseAssetBalanceOf(vault.address);
      assert.approximately(vaultBalance.sub(
        (new BN(assetAmount)).mul(new BN(4))).toNumber(),0, 1);
      let vaultBalance2 = await ivProfit.baseAssetBalanceOf(vault2.address);
      assert.approximately(vaultBalance2.sub(
        (new BN(assetAmount)).mul(new BN(2))).toNumber(),0, 1);

    });

    it("Profit accounting for one creditor and one Beneficary", async function() {

      await vault.addInvestmentVehicle(
        ivProfit.address,// newVehicle,
        10000,// _lendMaxBps (10000 is not restricted)
        constants.MAX_UINT256,// _lendCap
        {from: admin}
      );

      // remove the hodl, now all it's left is the ivProfit
      await vault.removeInvestmentVehicle(ivHodl.address, {from: admin});

      assert.equal(await vault.isDebtor(ivProfit.address), true);
      assert.equal(await vault.isDebtor(ivHodl.address), false);

      await ivProfit.addCreditor(
        vault.address,
        {from: admin}
      );
      // 50% of the profit goes to admin
      await ivProfit.addBeneficiary(admin, 10000/2, 0, {from: admin});
      assert.equal(await ivProfit.isBeneficiary(admin), true);

      await baseERC20.approve(vault.address, assetAmount, {from: user});
      await vault.deposit(assetAmount, {from: user});
      await vault.investAll({from:admin});
      assert.equal(await ivProfit.baseAssetBalanceOf(vault.address), assetAmount);
      assert.equal(await baseERC20.balanceOf(ivProfit.address), assetAmount);

      // set how much the strategy would gain when we call `collectProfitAndDistribute()`
      await ivProfit.setPumpReward((new BN(assetAmount)).mul(new BN(2)));
      // The balance is still the same because the profit hasn't been distributed.
      assert.equal((await ivProfit.baseAssetBalanceOf(vault.address)).toString(),
                    assetAmount.toString());

      let initialSharePrice = await ivProfit.sharePrice();
      let shareUnit = await ivProfit.SHARE_UNIT();
      assert.equal(initialSharePrice.toString(), shareUnit.toString());


      let afterProfitAmount = (new BN(assetAmount)).mul(new BN(2));
      await ivProfit.collectProfitAndDistribute(0, {from: admin});
      let afterSharePrice = await ivProfit.sharePrice();

      // Check if admin can claim the dividend.
      assert.equal(await baseERC20.balanceOf(admin), "0");
      await ivProfit.claimDividendAsBeneficiary({from: admin});
      assert.equal(await baseERC20.balanceOf(admin), assetAmount);
      // No more dividend after claiming.
      await expectRevert(
        ivProfit.claimDividendAsBeneficiary({from: admin}),
        "Must have non-zero dividend."
      );
      assert.equal(await baseERC20.balanceOf(admin), assetAmount);

      // The sharePrice should be doubled.
      assert.equal(initialSharePrice.mul(new BN(2)).toString(),
                   afterSharePrice.toString());

      // profit actually happened.
      assert.equal((await baseERC20.balanceOf(ivProfit.address)).toString(), afterProfitAmount.toString());

      // profit should be accounted to the vault in iv
      let vaultBalance = await ivProfit.baseAssetBalanceOf(vault.address);
      assert.equal(vaultBalance.toString(), afterProfitAmount.toString());

      // Withdraw from the IV.
      await vault.withdrawAllFromIV(ivProfit.address, {from: admin});
      assert.equal(await baseERC20.balanceOf(vault.address), assetAmount);
      // After withdraw, IV doesn't own vault any debt.
      assert.equal((await vault.baseAssetDebtOf(ivProfit.address)).toString(), "0");
      // The rest is the profit amount.
      assert.equal(await ivProfit.baseAssetBalanceOf(vault.address),
                   afterProfitAmount - assetAmount);

      // Check if admin can still claim beneficicary after being removed from the beneficiary list.
      await ivProfit.collectProfitAndDistribute(0, {from: admin});
      await ivProfit.removeBeneficiary(admin, {from: admin});
      assert.equal(await ivProfit.isBeneficiary(admin), false);
      await ivProfit.claimDividendAsBeneficiary({from: admin});
      // No more dividend after claiming.
      await expectRevert(
        ivProfit.claimDividendAsBeneficiary({from: admin}),
        "Must have non-zero dividend."
      );
    });

    it("Test moveInvestmentVehicleToLowestPriority", async function() {
      
      await vault.addInvestmentVehicle(
        ivProfit.address,
        10000,// _lendMaxBps (10000 is not restricted)
        constants.MAX_UINT256,// _lendCap
        {from: admin}
      );
      assert.equal(await vault.investmentVehiclesLength(), "2");
      assert.equal(await vault.getInvestmentVehicle("0"), ivHodl.address);
      assert.equal(await vault.getInvestmentVehicle("1"), ivProfit.address);
      
      // ivProfit is at the lowest priority already, so nothing changes.
      await vault.moveInvestmentVehicleToLowestPriority(ivProfit.address, {from: admin});
      assert.equal(await vault.investmentVehiclesLength(), "2");
      assert.equal(await vault.getInvestmentVehicle("0"), ivHodl.address);
      assert.equal(await vault.getInvestmentVehicle("1"), ivProfit.address);
      
      // Put ivHodl at the lowest priority.
      await vault.moveInvestmentVehicleToLowestPriority(ivHodl.address, {from: admin});
      assert.equal(await vault.investmentVehiclesLength(), "2");
      assert.equal(await vault.getInvestmentVehicle("1"), ivHodl.address);
      assert.equal(await vault.getInvestmentVehicle("0"), ivProfit.address);
      
      
    });

  });

});