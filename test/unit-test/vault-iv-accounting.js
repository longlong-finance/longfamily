const { deploy, obtainAndDepsitIntoVault, equalBN, approxBN, approxInAbsDiff } = require("../helpers/helpers.js");

const TimelockProxy = artifacts.require("TimelockProxy");
const TransferFromWhaleProfitUpgradeable = artifacts.require("TransferFromWhaleProfitUpgradeable");
const MockERC20 = artifacts.require("MockERC20");
const MockSwapCenter = artifacts.require("MockSwapCenter");
const TimelockProxyStorageCentered = artifacts.require("TimelockProxyStorageCentered");

const { BN, time, expectRevert, constants } = require('@openzeppelin/test-helpers');
const { assert } = require("chai");

describe("Vault IV acocunting", function(){

  let accounts;
  let admin;
  let proxyAdmin;
  let user;
  let assetGiver;

  let assetAmount;
  let profitAmount;

  let store;
  let vault1;
  let snx1;
  let vault2;
  let snx2;
  let baseERC20;
  let longERC20;
  let ivProfit1;
  let ivProfit2;
  let ivProfitImplementation;

  before(async function() {
    accounts = await web3.eth.getAccounts();
    admin = accounts[1];
    user = accounts[2];
    proxyAdmin = accounts[3];
    assetGiver = accounts[4];

    baseERC20 = await MockERC20.new("base", "BASED");
    longERC20 = await MockERC20.new("long", "LONGED");

    await baseERC20.mint(assetGiver, "10000000000" + "0".repeat(18));
    await longERC20.mint(assetGiver, "10000000000" + "0".repeat(18));

    ivProfitImplementation = await TransferFromWhaleProfitUpgradeable.new();
  });

  async function deployIVProfitandLinkWithVaults(vaults) {
    let ivProfitProxy = await TimelockProxyStorageCentered.new(
      ivProfitImplementation.address,
      store.address,
      0,    // no timelock
      "0x", // empty init call, call initialize later.
      {from: admin}
    );
    ivProfitTemp = await TransferFromWhaleProfitUpgradeable.at(ivProfitProxy.address);
    await ivProfitTemp.initialize(store.address, baseERC20.address);

    for( tempVault of vaults ) {
      await tempVault.addInvestmentVehicle(
        ivProfitTemp.address,// newVehicle,
        10000,// _lendMaxBps (10000 is not restricted)
        constants.MAX_UINT256,// _lendCap
        {from: admin}
      );

      await ivProfitTemp.addCreditor(
        tempVault.address,
        {from: admin}
      );
    }

    return ivProfitTemp;
  }

  async function deployMockSwapCenter(_store, _assetGiver) {
    let deployedSwapCenter = await MockSwapCenter.new();
    await _store.setSwapCenter(deployedSwapCenter.address, {from: admin});
    await deployedSwapCenter.setWhale(_assetGiver);
    return deployedSwapCenter;
  }

  beforeEach(async function() {
    store = await deploy.store(admin, proxyAdmin);
    [vault1, snx1] = await deploy.vaultWithMsnx(store.address, baseERC20.address, longERC20.address, admin, proxyAdmin);
    [vault2, snx2] = await deploy.vaultWithMsnx(store.address, baseERC20.address, longERC20.address, admin, proxyAdmin);
    swapCenter = await deployMockSwapCenter(store, assetGiver);
    // set exchange rate to 0.5. 2 base = 1 long
    await swapCenter.setExchangeRate(baseERC20.address, longERC20.address, 5000);

    // deploy iv1, link with vault1
    // iv1 is the default iv of vault1
    ivProfit1 = await deployIVProfitandLinkWithVaults([vault1]);

    // deploy iv2, link with vault1 and vault2
    // iv2 is the default iv of vault2, seconrdary iv of vault1.
    ivProfit2 = await deployIVProfitandLinkWithVaults([vault1, vault2]);

    // ivProfit1 gains 1000 everytime!
    profitAmount = "1000" + "0".repeat(18);
    await ivProfit1.setPumpReward(profitAmount);

    // mint to the whale, so that it has enough assets for providing profit and market
    await baseERC20.mint(assetGiver, "10000000000" + "0".repeat(18));
    await longERC20.mint(assetGiver, "10000000000" + "0".repeat(18));

    // whale provides the profit all the time.
    await ivProfit1.setWhale(assetGiver);
    await ivProfit2.setWhale(assetGiver);
    await baseERC20.approve(ivProfit1.address, constants.MAX_UINT256, {from: assetGiver});
    await baseERC20.approve(ivProfit2.address, constants.MAX_UINT256, {from: assetGiver});
    // whale is the market.
    await longERC20.approve(swapCenter.address, constants.MAX_UINT256, {from: assetGiver});    
  });

  describe("Accounting", function() {

    it("Accounting for a complex scenario", async function() {
      // User deposits 2000 into vault1
      // User deposits 2000 into vault2
      await obtainAndDepsitIntoVault(user, baseERC20, assetGiver, vault1, "2000" + "0".repeat(18));
      await obtainAndDepsitIntoVault(user, baseERC20, assetGiver, vault2, "2000" + "0".repeat(18));
      
      equalBN(await baseERC20.balanceOf(vault1.address), "2000" + "0".repeat(18));
      equalBN(await baseERC20.balanceOf(vault2.address), "2000" + "0".repeat(18));
      equalBN(await vault1.balanceOf(user), "2000" + "0".repeat(18));
      equalBN(await vault2.balanceOf(user), "2000" + "0".repeat(18));

      // Vault1 pushes all funds (2000 base) into default IV, which is ivProfit1
      await vault1.investAll({from:admin});

      equalBN(await baseERC20.balanceOf(vault1.address), "0");
      equalBN(await baseERC20.balanceOf(ivProfit1.address), "2000" + "0".repeat(18));
      equalBN(await vault1.balanceOf(user), "2000" + "0".repeat(18));
      equalBN(await vault2.balanceOf(user), "2000" + "0".repeat(18));
      equalBN((await vault1.vInfo(ivProfit1.address)).baseAssetDebt, "2000" + "0".repeat(18));
      equalBN((await ivProfit1.shareBalance(vault1.address)), "2000" + "0".repeat(18));

      // ivProfit1 profits, all profits (1000 base) accounted to vault1
      // 2000 share now corresponds to 3000 base, sharePrice should be 1.5
      await ivProfit1.collectProfitAndDistribute(0, {from: admin});
      equalBN((await vault1.vInfo(ivProfit1.address)).baseAssetDebt, "2000" + "0".repeat(18));
      equalBN((await ivProfit1.shareBalance(vault1.address)), "2000" + "0".repeat(18));
      equalBN((await ivProfit1.sharePrice()), "1" + "5" + "0".repeat(17)); //1.5

      // Vault1 withdraws some funds (600 base), that should be burning 400 shares
      await vault1.withdrawFromIV(ivProfit1.address, "600" + "0".repeat(18), {from: admin});
      equalBN((await vault1.vInfo(ivProfit1.address)).baseAssetDebt, "1400" + "0".repeat(18));
      equalBN((await ivProfit1.shareBalance(vault1.address)), "1600" + "0".repeat(18));
      equalBN((await ivProfit1.sharePrice()), "1" + "5" + "0".repeat(17)); //1.5

      // collectAndLong the profits from ivProfit1 (1000 base) => (500 long)
      // 500 long should be sent to snx1.
      // 1000 profit is around 666.66 shares
      await vault1.collectAndLong([ivProfit1.address], 0, {from: admin});
      equalBN((await vault1.vInfo(ivProfit1.address)).baseAssetDebt, "1400" + "0".repeat(18));
      approxBN((await ivProfit1.shareBalance(vault1.address)), "933" + "3".repeat(18), "10");
      equalBN((await ivProfit1.sharePrice()), "1" + "5" + "0".repeat(17)); //1.5
      equalBN(await longERC20.balanceOf(snx1.address), "500" + "0".repeat(18));
      equalBN(await baseERC20.balanceOf(ivProfit1.address), "1400" + "0".repeat(18));

      // vault1 withdraws some funds (600 base) from ivProfit1
      // 1000 base remaining in IV
      await vault1.withdrawFromIV(ivProfit1.address, "600" + "0".repeat(18), {from: admin});
      equalBN((await vault1.vInfo(ivProfit1.address)).baseAssetDebt, "800" + "0".repeat(18));
      approxBN((await ivProfit1.shareBalance(vault1.address)), "533" + "3".repeat(18), "10");
      equalBN((await ivProfit1.sharePrice()), "1" + "5" + "0".repeat(17)); //1.5
      equalBN(await baseERC20.balanceOf(vault1.address), "1200" + "0".repeat(18));
      equalBN(await baseERC20.balanceOf(ivProfit1.address), "800" + "0".repeat(18));

      // ivProfit1 profits (1000 base), all profits accounted to vault1
      await ivProfit1.collectProfitAndDistribute(0, {from: admin});
      equalBN(await baseERC20.balanceOf(ivProfit1.address), "1800" + "0".repeat(18));
      approxBN((await ivProfit1.shareBalance(vault1.address)), "533" + "3".repeat(18), "10");
      equalBN(await baseERC20.balanceOf(vault1.address), "1200" + "0".repeat(18));
      approxBN((await ivProfit1.sharePrice()), "3" + "375" + "0".repeat(15), "10"); // 3.375

      // vault1 pushes some funds (500 base) into ivProfit2
      await vault1.investTo(ivProfit2.address, "500" + "0".repeat(18), {from: admin});
      equalBN((await vault1.vInfo(ivProfit1.address)).baseAssetDebt, "800" + "0".repeat(18));
      equalBN((await vault1.vInfo(ivProfit2.address)).baseAssetDebt, "500" + "0".repeat(18));
      equalBN((await ivProfit2.sharePrice()), "1" + "0".repeat(18)); //1
      approxBN((await ivProfit1.sharePrice()), "3" + "375" + "0".repeat(15), "10"); // 3.375

      // ivProfit2 profits (1000 base), all profits accounted to vault1
      // 500 => (500 + 1000), sharePrice = 3
      // iv2.shareBalance[vault1] = 500
      await ivProfit2.setPumpReward("1000" + "0".repeat(18), {from: admin});
      await ivProfit2.collectProfitAndDistribute(0, {from: admin});
      equalBN((await vault1.vInfo(ivProfit1.address)).baseAssetDebt, "800" + "0".repeat(18));
      equalBN((await vault1.vInfo(ivProfit2.address)).baseAssetDebt, "500" + "0".repeat(18));
      equalBN((await ivProfit2.sharePrice()), "3" + "0".repeat(18)); //1
      approxBN((await ivProfit1.sharePrice()), "3" + "375" + "0".repeat(15), "10"); // 3.375

      // vault2 pushes 600 base into ivProfit2
      // in iv2: vault1 1500, vault2 600
      // iv2.shareBalance[vault1] = 500, iv2.shareBalance[vault2] = 200, sharePrice = 3
      await vault2.investTo(ivProfit2.address, "600" + "0".repeat(18), {from: admin});
      approxBN((await ivProfit2.shareBalance(vault2.address)), "200" + "0".repeat(18), "10");
      equalBN((await vault2.vInfo(ivProfit2.address)).baseAssetDebt, "600" + "0".repeat(18));

      // ivProfit2 profits (1400 base)
      // in iv2 total (3500). 
      // iv2.shareBalance[vault1] = 500, iv2.shareBalance[vault2] = 200, sharePrice = 5
      await ivProfit2.setPumpReward("1400" + "0".repeat(18), {from: admin});
      equalBN((await vault1.vInfo(ivProfit1.address)).baseAssetDebt, "800" + "0".repeat(18));
      equalBN((await vault1.vInfo(ivProfit2.address)).baseAssetDebt, "500" + "0".repeat(18));
      equalBN((await vault2.vInfo(ivProfit2.address)).baseAssetDebt, "600" + "0".repeat(18));
      await ivProfit2.collectProfitAndDistribute(0, {from: admin});
      equalBN((await ivProfit2.sharePrice()), "5" + "0".repeat(18)); 

      // vault1 withdraw all debt (800) from ivProfit1. (its profits still stay in ivProfit1)
      await vault1.withdrawAllFromIV(ivProfit1.address, {from: admin});
      equalBN((await vault1.vInfo(ivProfit1.address)).baseAssetDebt, "0");
      equalBN((await vault1.vInfo(ivProfit2.address)).baseAssetDebt, "500" + "0".repeat(18));
      approxBN((await ivProfit1.sharePrice()), "3" + "375" + "0".repeat(15), "10"); // 3.375
      approxBN((await ivProfit1.shareBalance(vault1.address)), "296" + "296".repeat(6), "10");
      equalBN((await baseERC20.balanceOf(ivProfit1.address)), "1000" + "0".repeat(18));
      
      // ivProfits1 profits (1000 base), since the profit is possible due to vault1's 
      // remaining share (which is accumulated via profit), it is accounted to vault1's profit.
      // vault1 remaining profit here is 1000, so adding 1000 would double the profit (and the sharePrice)
      await ivProfit1.setPumpReward("1000" + "0".repeat(18), {from: admin});
      await ivProfit1.collectProfitAndDistribute(0, {from: admin});
      approxBN((await ivProfit1.sharePrice()), "6" + "75" + "0".repeat(16), "10"); // 6.75 (3.375 * 2)
      equalBN((await baseERC20.balanceOf(ivProfit1.address)), "2000" + "0".repeat(18));


      // vault1 collects profit, should get 1000 long
      await vault1.collectAndLong([ivProfit1.address], 0, {from: admin});
      equalBN((await vault1.vInfo(ivProfit1.address)).baseAssetDebt, "0");
      approxInAbsDiff((await ivProfit1.shareBalance(vault1.address)), "0", "1", true); // "0" != "1" off by one numerical error. 
      approxBN(await longERC20.balanceOf(snx1.address), "1500" + "0".repeat(18), "15"); // 1000 new + 500 from previous

      // add beneficiary for ivProfits2, distribute 50% yields to it.
      // old shareprice = 5 (total 3500), yield 1400 and 50% went to beneficiary, sharePrice = 6
      // iv2.shareBalance[vault1] = 500, iv2.shareBalance[vault2] = 200, sharePrice = 6
      await ivProfit2.addBeneficiary(admin, 5000, 2, {from: admin});
      await ivProfit2.collectProfitAndDistribute(0, {from: admin}); // get 1400 base, 350 to vault1, 350 to vault2, 700 to admin
      equalBN((await ivProfit2.sharePrice()), "6" + "0".repeat(18)); 

      // vault1, vault2 withdraw everything and collect all the profits, they should have close to 0 in shareBalance
      await vault1.withdrawAllFromIV(ivProfit2.address, {from: admin});
      await vault2.withdrawAllFromIV(ivProfit2.address, {from: admin});
      await vault1.collectAndLong([ivProfit2.address], 0, {from: admin});
      await vault2.collectAndLong([ivProfit2.address], 0, {from: admin});
      approxInAbsDiff((await ivProfit2.shareBalance(vault1.address)), "0", "1", true); // "0" != "1" off by one numerical error. 
      approxInAbsDiff((await ivProfit2.shareBalance(vault2.address)), "0", "1", true); // "0" != "1" off by one numerical error. 

      console.log("ivProfit2.shareBalance[vault1]: ", (await ivProfit2.shareBalance(vault1.address)).toString());
      console.log("ivProfit2.shareBalance[vault2]: ", (await ivProfit2.shareBalance(vault2.address)).toString());
      console.log("ivProfit2.sharePrice():         ", (await ivProfit2.sharePrice()).toString())
      equalBN((await ivProfit2.sharePrice()), "6" + "0".repeat(18)); 

      // let's have governance be the creditor of the ivProfit2 by depositing a little bit. all the interests should be accounted there.
      await baseERC20.mint(admin, "60" + "0".repeat(18));
      await baseERC20.approve(ivProfit2.address,"60" + "0".repeat(18), {from: admin});
      await ivProfit2.askToInvestAsCreditor("60" + "0".repeat(18), {from: admin});
      console.log("Interest accrue, this interest mostly comes from the beneficiaries' funds in the iv");      
      await ivProfit2.collectProfitAndDistribute(0, {from: admin}); // get 1400 base, 350 to vault1, 350 to vault2, 700 to admin
      console.log("ivProfit2.shareBalance[vault1]: ", (await ivProfit2.shareBalance(vault1.address)).toString());
      console.log("ivProfit2.shareBalance[vault2]: ", (await ivProfit2.shareBalance(vault2.address)).toString());
      console.log("ivProfit2.sharePrice():         ", (await ivProfit2.sharePrice()).toString())

    });
  });

});