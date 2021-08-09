const TimelockRegistryUpgradeable = artifacts.require("TimelockRegistryUpgradeable");
const TimelockProxy = artifacts.require("TimelockProxy");
const TimelockProxyStorageCentered = artifacts.require("TimelockProxyStorageCentered");

const { BN, time, expectRevert, constants, send } = require('@openzeppelin/test-helpers');
const { assert } = require("chai");

const { resetToBlock, impersonate, deploy, equalBN, approxBN, ltBN } = require("../helpers/helpers.js");

describe("Timelock", function(){

    let accounts;
    let admin;
    let proxyAdmin;
    let user;
  
    let store;
    let timelockImplementation;
    let timelock;

    before(async function() {
        accounts = await web3.eth.getAccounts();
        admin = accounts[1];
        user = accounts[2];
        proxyAdmin = accounts[3];

        vault = accounts[5];
        iv = accounts[6];

        store = await deploy.store(admin, proxyAdmin);
        timelockImplementation = await TimelockRegistryUpgradeable.new();
    });
  
    beforeEach(async function() {
        proxy = await TimelockProxyStorageCentered.new(
            timelockImplementation.address,
            store.address, // owner of proxy
            0,    // no timelock
            "0x",
            {from: admin}
        );

        timelock = await TimelockRegistryUpgradeable.at(proxy.address);
        await timelock.initialize(store.address, {from: admin});
        await timelock.changeTimelockDelay("86400", {from: admin});
        await time.increase(86400);
        await time.advanceBlock();
    });
  
    describe("Timelock tests", function() {
        it("Announcing IV for vault", async function(){
            await timelock.announceIVForVault(vault, iv, {from: admin});
            assert.equal(await timelock.isIVActiveForVault(vault, iv), false); // immediate result is false, because of timelock
            await time.increase(86400);
            assert.equal(await timelock.isIVActiveForVault(vault, iv), true); // after time has passed, it is automatically active
            await timelock.removeIVForVault(vault, iv, {from: admin});
            assert.equal(await timelock.isIVActiveForVault(vault, iv), false); 
        });
  
        it("Announcing IV for global", async function(){
            await timelock.announceIVForGlobal(iv, {from: admin});
            assert.equal(await timelock.isIVActiveForVault(vault, iv), false); // immediate result is false, because of timelock
            await time.increase(86400);
            assert.equal(await timelock.isIVActiveForVault(vault, iv), true); // after time has passed, it is automatically active
            await timelock.removeIVForGlobal(iv, {from: admin});
            assert.equal(await timelock.isIVActiveForVault(vault, iv), false); 
        });

        it("Announcing IV for insurance Vault", async function(){
            await timelock.announceIVToBeInsuredByInsuranceVault(vault, iv, {from: admin});
            assert.equal(await timelock.isIVInsuredByInsuranceVault(vault, iv), false); // immediate result is false, because of timelock
            await time.increase(86400);
            assert.equal(await timelock.isIVInsuredByInsuranceVault(vault, iv), true); // after time has passed, it is automatically active
            await timelock.stopFutureInsuringIV(vault, iv, {from: admin});
            assert.equal(await timelock.isIVInsuredByInsuranceVault(vault, iv), false); 
        });
      
        it("Timelock change", async function(){
            assert.equal(await timelock.effectiveTimelock(), "86400");
            await timelock.changeTimelockDelay("2000", {from: admin});
            await timelock.announceIVForGlobal(iv, {from: admin});
            await time.increase(2000);
            assert.equal(await timelock.isIVActiveForVault(vault, iv), false); // immediate result is false, because of timelock
            await time.increase(86400); // new timelockDelay should be effective by now

            // cleaning up
            assert.equal(await timelock.isIVActiveForVault(vault, iv), true); 
            await timelock.removeIVForGlobal(iv, {from: admin})
            assert.equal(await timelock.isIVActiveForVault(vault, iv), false);

            // should be activated after 2000 since the new delay is active
            await timelock.announceIVForGlobal(iv, {from: admin});
            await time.increase(2000);
            assert.equal(await timelock.isIVActiveForVault(vault, iv), true);  
        });
        

    });
  
  });
  