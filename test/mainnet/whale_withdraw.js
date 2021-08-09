var path = require('path');
if(process.env.RUNNING_COVERAGE) {
  var scriptName = path.basename(__filename);
  console.log("  Skipping " + scriptName);
  return ;
}
const { resetToBlock, impersonate, deploy, eth_address } = require("../helpers/helpers.js");

const VaultUpgradeable = artifacts.require("VaultUpgradeable");
const StorageV1Upgradeable = artifacts.require("StorageV1Upgradeable");
const StakingMultiRewardsUpgradeable = artifacts.require("StakingMultiRewardsUpgradeable");
const SelfCompoundingYieldUpgradeable = artifacts.require("SelfCompoundingYieldUpgradeable");
const SwapCenter = artifacts.require("SwapCenter");

const TimelockProxy = artifacts.require("TimelockProxy");
const TimelockProxyStorageCentered = artifacts.require("TimelockProxyStorageCentered");
const IERC20 = artifacts.require("IERC20");

const YearnV2VaultV1Base = artifacts.require("YearnV2VaultV1Base");
const IYearnController = artifacts.require("IYearnController");
const IYearnStrategy = artifacts.require("IYearnStrategy");
const IYearnVaultV2 = artifacts.require("IYearnVaultV2");

const InvestmentVehicleSingleAssetBaseV1Upgradeable = artifacts.require("InvestmentVehicleSingleAssetBaseV1Upgradeable");

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
  let wethAddr = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
  let usdcAddr = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
  let yVaultV2USDCAddr = "0x5f18c75abdae578b483e5f43f12a39cf75b973a9";

  // settings
  let baseERC20;

  before(async function() {
    accounts = await web3.eth.getAccounts();
    admin ="0xca113e3be8efa4cd592c6ea7678dd7b7eb201e4d";
    user = accounts[2];
    whale = accounts[3];
    etherGiver = accounts[4]; 

  });

  async function obtainAssetFor(target, whale, tokenAddress, amount) {
    await impersonate([whale]);
    await impersonate([admin]);
    let token = await IERC20.at(tokenAddress);
    await send.ether(etherGiver, whale, "1000000000000000000"); // 1ETH
    await token.transfer(target, amount, {from: whale});
  }

  describe("Complete system deployment and test", function() {
    // block number: 
    let usdcHolder = "0x47ac0fb4f2d84898e4d9e7b4dab3c24507a6d503";
    let yearnStrategist = "0x710295b5f326c2e47e6dd2e7f6b5b0f7c5ac2f24";
    let yearnStrategyAddr = "0x4D7d4485fD600c61d840ccbeC328BfD76A050F87";
    let yearnGov = "0xFEB4acf3df3cDEA7399794D0869ef76A6EfAff52";

    let depositBalance = "10" + "000000";
    let whaleDepositBalance = "50000000" + "000000"; // 50m


    // 01 deploy
    let vaultImplementation;
    let storageImplementation;
    let msnxImplementation;
    let selfCompoundingYieldImplementation;
    let yearnV2IVImplementation;

    // 02 storage
    let storage;

    // 03 swapCenter
    let swapCenter;

    // 04 scYield
    let scYields;

    // 05 vault
    let vault;

    // 06 iv
    let iv;

    async function fetchMainnetContracts(){
        storage = await StorageV1Upgradeable.at("0x7Cb574C01d373B9780c42A3B0939809b5e807217");
        vault = await VaultUpgradeable.at(
            "0x24b3f236668448c0b7c5ca4e65798b3f23b660e6" // USDC_WETH
        );
        iv = await InvestmentVehicleSingleAssetBaseV1Upgradeable.at(
            "0x59645502a430e5dA3289ddb70EF662E0a7FCa17d"
        );   
    }

    beforeEach(async function() {
        // London: 12,965,000  12837206
        await resetToBlock(12982844);
        await impersonate([usdcHolder]);
        await impersonate([yearnStrategist]);
        await impersonate([yearnGov]);
    
        await fetchMainnetContracts();

        await obtainAssetFor(user, usdcHolder, usdcAddr, depositBalance);
        await obtainAssetFor(whale, usdcHolder, usdcAddr, whaleDepositBalance);
    });

    async function printInfo(){
        ivInvested = await iv.invested();
        inVault = await baseERC20.balanceOf(vault.address);
        inIv = await baseERC20.balanceOf(iv.address);
        whaleBalance = await baseERC20.balanceOf(whale);
        userBalance = await baseERC20.balanceOf(user);


        console.log("=======================================");
        console.log(
            "Whale Bal  : ", whaleBalance.toString()
        );

        console.log(
            "User Bal   : ", userBalance.toString()
        );

        console.log(
            "In Vault   : ", inVault.toString()
        );
        console.log(
            "In IV      : ", inIv.toString()
        );
        console.log(
            "IV invested: ", ivInvested.toString()
        );
    }


    it("User deposit in USDC vault", async function(){

        await vault.setDepositCap(
            "510000000" + "000000",
            {from: admin}
        );

        baseERC20 = await IERC20.at(usdcAddr);
        await printInfo();
        // whale deposit. 
        await baseERC20.approve(vault.address, whaleDepositBalance, {from: whale});
        await vault.deposit(whaleDepositBalance, {from:whale});
        await vault.investAll({from:admin});
        await iv.investAll({from: admin});
        await printInfo();

        // small user deposit.
        await baseERC20.approve(vault.address, depositBalance, {from: user});
        await vault.deposit(depositBalance, {from: user});
        await printInfo();
  
        // await vault.investAll({from:admin});
        // await iv.investAll({from: admin});  
        // pass 4 week so that there's no fee
        // await time.increase(86400 * 7 * 4);
  
        await printInfo();
        await vault.withdraw(whaleDepositBalance, {from: whale});
        await printInfo();

        await vault.withdraw(depositBalance, {from: user});
        await printInfo();



        // assert.approximately((
        //   (new BN(depositBalance)).sub(await baseERC20.balanceOf(user))).toNumber(),
        //   0, 10
        // );
    });

  });


});
