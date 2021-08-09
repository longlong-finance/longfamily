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
    admin = accounts[1];
    user = accounts[2];
    etherGiver = accounts[4]; 

  });

  async function obtainAssetFor(target, whale, tokenAddress, amount) {
    await impersonate([whale]);
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

    let depositBalance = "100000" + "000000";
    let depositHalfBalance = "50000" + "000000";


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
    let vaults;

    // 06 iv
    let ivs;

   


    async function deploySCYield(yieldId, baseAddr) {
        scYieldInitCall = web3.eth.abi.encodeFunctionCall({
            name: 'initialize',
            type: 'function',
            inputs: [{
              type: 'address',
              name: 'storage'
            },{
              type: 'address',
              name: 'base'
            }]
        }, [storage.address, baseAddr]);

        currentSCYield = await TimelockProxyStorageCentered.new(
            selfCompoundingYieldImplementation.address,
            storage.address,
            0, // timelock
            scYieldInitCall
        );

        scYields[yieldId] = await SelfCompoundingYieldUpgradeable.at(currentSCYield.address);
    }



    function formulateMsnxInitCall(storageAddr, rewardDistribution, vaultAddr, longAddr, duration, isSelfCompounding) {
        return web3.eth.abi.encodeFunctionCall({
          name: 'initialize',
          type: 'function',
          inputs: [{
            type: 'address',
            name: '_store'
          },{
            type: 'address',
            name: '_rewardsDistribution'
          },{
            type: 'address',
            name: '_vaultAddress'
          },{
              type: 'address',
              name: '_yieldToken'
          },{
              type: 'uint256',
              name: '_yieldDuration'
          },{
            type: 'bool',
            name: '_isSelfCompounding'
          },]                
        },[
          storageAddr,
          rewardDistribution,
          vaultAddr,
          longAddr,
          duration, // The yields are distributed for 7 days.
          isSelfCompounding
        ]);
      } 

    async function deployVault(
        vaultId, 
        baseAddr, 
        longAddr, 
        cap,
        scYieldId=false
    ) {
        vaultInitCall = web3.eth.abi.encodeFunctionCall({
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
              name: 'long'
            },{
              type: 'uint256',
              name: 'cap'
            },]
        }, [storage.address, baseAddr, longAddr, cap]);

        curVault = await TimelockProxyStorageCentered.new(
            vaultImplementation.address,
            storage.address,
            0, // timelock
            vaultInitCall
        );

        vaults[vaultId] = await VaultUpgradeable.at(curVault.address);
        
        let msnxInitCall;
        if(scYieldId == false) {
            msnxInitCall = formulateMsnxInitCall(
                storage.address,
                admin,
                vaults[vaultId].address,
                longAddr,
                86400, // The yields are distributed for 7 days.
                false
            );       
        } else {
            msnxInitCall = formulateMsnxInitCall(
                storage.address,
                admin,
                vaults[vaultId].address,
                scYields[scYieldId].address,
                86400, // The yields are distributed for 7 days.
                true
            );               
        }

        await scYields[scYieldId].addWhitelistDeposit(vaults[vaultId].address, {from: admin});
        curMSNX = await TimelockProxyStorageCentered.new(
            msnxImplementation.address,
            storage.address,
            0, // timelock
            msnxInitCall
        );

        msnxs[vaultId] = await StakingMultiRewardsUpgradeable.at(curMSNX.address);

        await vaults[vaultId].setRewardPool(msnxs[vaultId].address, {from: admin});
    }

    async function deployYearnIV(ivId, baseAddr, yVaultAddr) {
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
            }, [storage.address, baseAddr, yVaultAddr]);
    
        let ivProxy = await TimelockProxyStorageCentered.new(
            yearnV2IVImplementation.address,
            storage.address,
            0,    // no timelock
            yearnIVInitCall,
            {from: admin}
        );

        ivs[ivId] = await YearnV2VaultV1Base.at(ivProxy.address);
    }


    async function linkVaultAndIV(vaultId, ivId, vaultLendCap) {
        vault = vaults[vaultId];
        iv = ivs[ivId];
        await vault.addInvestmentVehicle(
            iv.address,
            10000,
            vaultLendCap,
            {from: admin}
        );

        await iv.addCreditor(
            vault.address,
            {from: admin}
        );
    }

    async function deploy_01_implementations() {
        vaultImplementation = await VaultUpgradeable.new({from: admin});
        storageImplementation = await StorageV1Upgradeable.new({from: admin});
        msnxImplementation = await StakingMultiRewardsUpgradeable.new({from: admin});
        selfCompoundingYieldImplementation = await SelfCompoundingYieldUpgradeable.new({from: admin});
        yearnV2IVImplementation= await YearnV2VaultV1Base.new({from: admin});
    }

    async function deploy_02_storage() {
        storageInitCall = web3.eth.abi.encodeFunctionCall({
            name: 'initialize',
            type: 'function',
            inputs: [{
            type: 'address',
            name: '_governance'
            }, {
            type: 'address',
            name: '_proxyAdmin'
            }]
        }, [admin, admin]);
        
        storage = await TimelockProxy.new(
            storageImplementation.address,
            admin,
            0,
            storageInitCall,
            {from: admin}
        );
    }

    async function deploy_03_swapCenter() {
        swapCenter = await SwapCenter.new();
    }

    async function deploy_04_scYields() {
        scYields = [];
        await deploySCYield("WETH", "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2");
    }

    async function deploy_05_vaults() {
        vaults = [];
        msnxs = [];
        await deployVault(
            "USDC_WETH", 
            eth_address.usdc, // USDC base 
            eth_address.weth, // WETH long
            "10000" + "0".repeat(6), // depositCap
            "WETH"
          );
    }
    async function deploy_06_yearnIVInstance() {
        ivs = [];
        await deployYearnIV(
            "yUSDC", 
            usdcAddr, 
            yVaultV2USDCAddr
        );
    }

    async function deploy_07_linkingVaultAndIV() {
        await linkVaultAndIV("USDC_WETH","yUSDC", "200000" + "0".repeat(6));
    }

    beforeEach(async function() {
        await resetToBlock(12649174);
        await impersonate([usdcHolder]);
        await impersonate([yearnStrategist]);
        await impersonate([yearnGov]);
    
        await deploy_01_implementations();
        await deploy_02_storage();
        await deploy_03_swapCenter();
        await deploy_04_scYields();
        await deploy_05_vaults();
        await deploy_06_yearnIVInstance();
        await deploy_07_linkingVaultAndIV();

        await obtainAssetFor(user, usdcHolder, usdcAddr, depositBalance);
    });


    it("User deposit in USDC vault", async function(){

        baseERC20 = await IERC20.at(usdcAddr);
        vault = vaults["USDC_WETH"];
        ivYearn = ivs["yUSDC"];

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

  });


});
