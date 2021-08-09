var path = require('path');
if(process.env.RUNNING_COVERAGE) {
  var scriptName = path.basename(__filename);
  console.log("  Skipping " + scriptName);
  return ;
}
const { resetToBlock, impersonate, deploy } = require("../../helpers/helpers.js");

const TimelockProxy = artifacts.require("TimelockProxy");
const VaultUpgradeable = artifacts.require("VaultUpgradeable");
const StorageV1Upgradeable = artifacts.require("StorageV1Upgradeable");
const TimelockProxyStorageCentered = artifacts.require("TimelockProxyStorageCentered");
const YearnV2VaultV1Base = artifacts.require("YearnV2VaultV1Base");
const IYearnController = artifacts.require("IYearnController");
const IYearnStrategy = artifacts.require("IYearnStrategy");
const IYearnVaultV2 = artifacts.require("IYearnVaultV2");
const IERC20 = artifacts.require("IERC20");

const { BN, time, expectRevert, send, constants } = require('@openzeppelin/test-helpers');
const { assert } = require('chai');

describe("Yearn V2 Vault USDC test", function(){

  let accounts;
  let admin;
  let proxyAdmin;
  let user;
  let etherGiver;

  // protocol contract
  let vault;
  let store;
  let ivYearn;

  // external contract
  let weth = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
  let usdc = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
  let yVaultV2USDC = "0x5f18c75abdae578b483e5f43f12a39cf75b973a9";

  // settings
  let baseERC20;

  before(async function() {
    accounts = await web3.eth.getAccounts();
    admin = accounts[1];
    user = accounts[2];
    proxyAdmin = accounts[3];
    etherGiver = accounts[4]; 

  });

  async function obtainAssetFor(target, whale, tokenAddress, amount) {
    await impersonate([whale]);
    let token = await IERC20.at(tokenAddress);
    await send.ether(etherGiver, whale, "1000000000000000000"); // 1ETH
    await token.transfer(target, amount, {from: whale});
  }

  describe("YearnIV", function() {
    // block number: 12304074
    let usdcHolder = "0x47ac0fb4f2d84898e4d9e7b4dab3c24507a6d503";
    let yearnStrategist = "0x710295b5f326c2e47e6dd2e7f6b5b0f7c5ac2f24";
    let yearnStrategyAddr = "0x4D7d4485fD600c61d840ccbeC328BfD76A050F87";
    let yearnGov = "0xFEB4acf3df3cDEA7399794D0869ef76A6EfAff52";

    let depositBalance = "100000" + "000000";
    let depositHalfBalance = "50000" + "000000";

   

    beforeEach(async function() {
        await resetToBlock(12649174);
        await impersonate([usdcHolder]);
        await impersonate([yearnStrategist]);
        await impersonate([yearnGov]);

        baseERC20 = await IERC20.at(usdc);

        console.log("Yearn Strategy Addr: ", yearnStrategyAddr);
        yearnStrategy = await IYearnStrategy.at(yearnStrategyAddr);

        // Change the strategist to yearnGov to ease harvest operation in test
        await yearnStrategy.setStrategist(admin, {from: yearnGov});

        await baseERC20.transfer(usdcHolder, await baseERC20.balanceOf(user), {from: user});
        await obtainAssetFor(user, usdcHolder, usdc, depositBalance);
        
        yearnV2IVImplementation= await YearnV2VaultV1Base.new();

        store = await deploy.store(admin, proxyAdmin);
        [vault, snx] = await deploy.vaultWithMsnx(store.address, baseERC20.address, weth, admin, proxyAdmin);
        swapCenter = await deploy.swapCenter(store, admin);


        // yearnIV deployment
        yearnIVInitCall = web3.eth.abi.encodeFunctionCall({
        name: 'initialize',
        type: 'function',
        inputs: [{
            type: 'address',
            name: 'storage'
        },{
            type: 'address',
            name: 'base'
        },{
            type: 'address',
            name: 'yVault'
        },]
        }, [store.address, baseERC20.address, yVaultV2USDC]);

        let ivProxy = await TimelockProxyStorageCentered.new(
          yearnV2IVImplementation.address,
          store.address,
          0,    // no timelock
          yearnIVInitCall,
          {from: admin}
        );

        ivYearn = await YearnV2VaultV1Base.at(ivProxy.address);

        await vault.addInvestmentVehicle(
          ivYearn.address,// newVehicle,
          10000,// _lendMaxBps (10000 is not restricted)
          constants.MAX_UINT256,// _lendCap
          {from: admin}
        );
        assert.equal(1, await vault.investmentVehiclesLength());

        await ivYearn.addCreditor(
          vault.address,
          {from: admin}
        );
    
    });

    it("Deposit and Withdraw immediately", async function(){
      console.log("balance: ", (await baseERC20.balanceOf(user)).toString() );
      await baseERC20.approve(vault.address, depositBalance, {from: user});
      await vault.deposit(depositBalance, {from: user});

      assert.equal(await baseERC20.balanceOf(vault.address), depositBalance);
      await vault.investAll({from:admin});
      assert.equal(await baseERC20.balanceOf(ivYearn.address), depositBalance);
      await ivYearn.investAll({from: admin});
      assert.equal(await baseERC20.balanceOf(ivYearn.address), "0");

      // pass 4 week so that there's no fee
      await time.increase(86400 * 7 * 4);

      assert.equal(await baseERC20.balanceOf(user), "0");
      await vault.withdraw(depositBalance, {from: user});
      assert.approximately((
        (new BN(depositBalance)).sub(await baseERC20.balanceOf(user))).toNumber(),
        0, 10
      );
    });

    it("Deposit and Withdraw after yearn harvest", async function(){
      await baseERC20.approve(vault.address, depositBalance, {from: user});
      await vault.deposit(depositBalance, {from: user});

      await vault.investAll({from:admin});
      console.log("await baseERC20.balanceOf(ivYearn.address)",(await baseERC20.balanceOf(ivYearn.address)).toString());
      assert.equal(await baseERC20.balanceOf(ivYearn.address), depositBalance);
      await ivYearn.investAll({from: admin});
      assert.equal(await baseERC20.balanceOf(ivYearn.address), "0");

      // Yearn Harvest


      yVault = await IYearnVaultV2.at(yVaultV2USDC);
      console.log("expected return", (await yVault.expectedReturn(yearnStrategyAddr)).toString());
      console.log("price per share", (await yVault.pricePerShare()).toString());
      console.log("total debt", (await yVault.totalDebt()).toString());
      
      let tx = await yearnStrategy.harvest({from: yearnGov});
      //console.log(tx);
      console.log("expected return", (await yVault.expectedReturn(yearnStrategyAddr)).toString());
      console.log("price per share", (await yVault.pricePerShare()).toString());
      console.log("total debt", (await yVault.totalDebt()).toString());

      let sharePriceBefore = await ivYearn.sharePrice();
      assert.equal(sharePriceBefore.toString(), "1" + "0".repeat(18));
      await ivYearn.collectProfitAndDistribute(0, {from: admin});
      let sharePriceAfter = await ivYearn.sharePrice();

      console.log("sharePriceBefore: ", sharePriceBefore.toString());
      console.log("sharePriceAfter:  ", sharePriceAfter.toString());

      // Make sure there's profit
      assert.equal(true, sharePriceAfter.gt(sharePriceBefore));

      assert.equal(await baseERC20.balanceOf(user), "0");

      // pass 4 week so that there's no fee
      await time.increase(86400 * 7 * 8);

      wethContract = await IERC20.at(weth);
      assert.equal(await wethContract.balanceOf(snx.address), "0");
      await vault.collectAndLong([ivYearn.address],0 , {from: admin});
      assert.notEqual(await wethContract.balanceOf(snx.address), "0");

      await vault.withdraw(depositBalance, {from: user});

      // User should be able to get the base funds.
      assert.approximately((
        (new BN(depositBalance)).sub(await baseERC20.balanceOf(user))).toNumber(),
        0, 10
      );
    });

  });


});
