const { deploy, passTime, approxBN } = require("../helpers/helpers.js");

const TimelockProxy = artifacts.require("TimelockProxy");
const VaultUpgradeable = artifacts.require("VaultUpgradeable");
const StorageV1Upgradeable = artifacts.require("StorageV1Upgradeable");
const MockERC20 = artifacts.require("MockERC20");
const SelfCompoundingYieldUpgradeable = artifacts.require("SelfCompoundingYieldUpgradeable");


const { time, expectRevert } = require('@openzeppelin/test-helpers');

const { BN } = require('@openzeppelin/test-helpers/src/setup');

describe("SNX basic", function(){

  let accounts;
  let admin;
  let proxyAdmin;
  let user;
  let user2;

  let store;
  let vault;
  let vaultImplmentation;
  let baseERC20;
  let longERC20;

  let snx;
  let assetAmount;

  before(async function() {
    accounts = await web3.eth.getAccounts();
    admin = accounts[1];
    user = accounts[2];
    proxyAdmin = accounts[3];
    user2 = accounts[4];
    vaultImplmentation = await VaultUpgradeable.new();
    storageImplementation = await StorageV1Upgradeable.new();
  });

  beforeEach(async function() {
    baseERC20 = await MockERC20.new("base", "BASED");
    longERC20 = await MockERC20.new("long", "LONGED");
    store = await deploy.store(admin, proxyAdmin);
    [vault, snx] = await deploy.vaultWithMsnx(store.address, baseERC20.address, longERC20.address, admin, proxyAdmin);

    assetAmount = "1000" + "0".repeat(18);
  });

  async function mintAndDepsitIntoVault(_user, _baseAsset, _vault, _assetAmount){
    await _baseAsset.mint(_user, _assetAmount);
    await _baseAsset.approve(_vault.address, _assetAmount, {from: _user});
    await _vault.deposit(_assetAmount, {from: _user});
  }

  async function mintRewardAndNotify(_pool, _reward, _amount, _rewardDistribution){
    await _reward.mint(_pool.address, _amount);
    await _pool.notifyTargetRewardAmount(_reward.address, _amount, {from: _rewardDistribution});
  }

  describe("SNX pool", function() {
    it("one person stake and get reward", async function(){
      await mintAndDepsitIntoVault(user, baseERC20, vault, assetAmount);

      assert.equal(await baseERC20.balanceOf(vault.address), assetAmount);
      assert.equal(await vault.balanceOf(user), assetAmount);

      await mintRewardAndNotify(snx, longERC20, assetAmount, admin);

      await passTime(86400);

      assert.equal(await longERC20.balanceOf(user), 0);
      await snx.getAllRewards({from: user});

      approxBN(assetAmount, await longERC20.balanceOf(user), 5);
    });

    it("one person deposit and withdraw immediately but tries to get reward", async function(){
      assert.equal(await vault.balanceOf(user), "0");
      await mintAndDepsitIntoVault(user, baseERC20, vault, assetAmount);
      await vault.withdraw(assetAmount, {from: user});
      assert.equal(await vault.balanceOf(user), "0");

      await mintRewardAndNotify(snx, longERC20, assetAmount, admin);

      await passTime(86400);

      assert.equal(await longERC20.balanceOf(user), 0);
      await snx.getAllRewards({from: user});
      assert.equal((await longERC20.balanceOf(user)).toString(), "0");
    });

    it("one person stake and transfer to the other, the other gets reward", async function(){
      await mintAndDepsitIntoVault(user, baseERC20, vault, assetAmount);
      await vault.transfer(user2, assetAmount, {from: user});

      assert.equal(await vault.balanceOf(user2), assetAmount);

      await mintRewardAndNotify(snx, longERC20, assetAmount, admin);

      await passTime(86400);

      assert.equal(await longERC20.balanceOf(user2), 0);
      await snx.getAllRewards({from: user2});
      approxBN(assetAmount, await longERC20.balanceOf(user2), 5, true);
    });

    it("one person stakes and accumlates some reward. transfer to the other, the other gets reward", async function(){
      await mintAndDepsitIntoVault(user, baseERC20, vault, assetAmount);
      await mintRewardAndNotify(snx, longERC20, assetAmount, admin);
      await passTime(86400);

      await vault.transfer(user2, assetAmount, {from: user});

      await mintRewardAndNotify(snx, longERC20, assetAmount, admin);
      await passTime(86400);

      assert.equal(await longERC20.balanceOf(user), 0);
      await snx.getAllRewards({from: user});
      approxBN(assetAmount, await longERC20.balanceOf(user), 5, true);

      assert.equal(await longERC20.balanceOf(user2), 0);
      await snx.getAllRewards({from: user2});
      approxBN(assetAmount, await longERC20.balanceOf(user2), 5, true);
    });

    it("add another reward token. Users are able to receive them.", async function(){
      let anotherReward = await MockERC20.new("ANO", "ANOTHER");
      await snx.addReward(anotherReward.address, 86400 * 7, false, {from: admin});
      await mintAndDepsitIntoVault(user, baseERC20, vault, assetAmount);
      await mintRewardAndNotify(snx, anotherReward, assetAmount, admin);
      await mintRewardAndNotify(snx, longERC20, assetAmount, admin);
      await passTime(86400);

      // the user can get both rewards.
      await snx.getAllRewards({from: user});
      let oneSeventhAmount = (new BN(assetAmount)).div(new BN(7));
      approxBN(oneSeventhAmount, await anotherReward.balanceOf(user), 4, true);
      approxBN(assetAmount, await longERC20.balanceOf(user), 5, true);

      await passTime(86400 * 6);
      await snx.getAllRewards({from: user});
      approxBN(assetAmount, await anotherReward.balanceOf(user), 7, true);
    });

    it("the new reward cannot be removed during distribution.", async function(){
      let anotherReward = await MockERC20.new("ANO", "ANOTHER");
      await snx.addReward(anotherReward.address, 86400 * 7, false, {from: admin});
      await mintAndDepsitIntoVault(user, baseERC20, vault, assetAmount);
      await mintRewardAndNotify(snx, anotherReward, assetAmount, admin);
      await passTime(86400);

      // shouldn't be able to remove during distribution
      await expectRevert(snx.removeReward(anotherReward.address, {from: admin}), "still distributing, cannot remove");

      await passTime(86400 * 6);

      // can be removed after the distribution
      await snx.removeReward(anotherReward.address, {from: admin});
    });

    it("set a new reward distribution, it can notify pool.", async function(){
      await expectRevert(snx.notifyTargetRewardAmount(longERC20.address, assetAmount, {from: user}), "Caller is not RewardsDistribution");
      await snx.setRewardDistribution([user], true, {from: admin});
      await snx.notifyTargetRewardAmount(longERC20.address, assetAmount, {from: user});
      await snx.setRewardDistribution([user], false, {from: admin});
      await expectRevert(snx.notifyTargetRewardAmount(longERC20.address, assetAmount, {from: user}), "Caller is not RewardsDistribution");
    });

    it("Revert erroneous add/removal of rewards", async function(){
      let anotherReward = await MockERC20.new("ANO", "ANOTHER");

      // cannot remove a reward that is not being added.
      await expectRevert(snx.removeReward(anotherReward.address, {from: admin}), "Token is not in the set");

      // cannot remove the last reward
      await expectRevert(snx.removeReward(longERC20.address, {from: admin}), "Cannot remove the last yield");

      // cannot add something that is already in the reward set
      await expectRevert(snx.addReward(longERC20.address, 86400, false, {from: admin}), "Token is already in the set");
    });


    it("Two vault share holder getting rewards", async function(){
      let doubleAssetAmount = (new BN(assetAmount)).mul(new BN(2));

      await mintAndDepsitIntoVault(user, baseERC20, vault, assetAmount);
      await mintAndDepsitIntoVault(user2, baseERC20, vault, assetAmount);

      assert.equal(await baseERC20.balanceOf(vault.address), doubleAssetAmount.toString());

      await mintRewardAndNotify(snx, longERC20, assetAmount, admin);
      await mintRewardAndNotify(snx, longERC20, assetAmount, admin);

      await passTime(86400);

      assert.equal(await longERC20.balanceOf(user), 0);
      assert.equal(await longERC20.balanceOf(user2), 0);
      await snx.getAllRewards({from: user});
      await snx.getAllRewards({from: user2});

      approxBN(assetAmount, await longERC20.balanceOf(user), 3, true);
      approxBN(assetAmount, await longERC20.balanceOf(user2), 3, true);
    });

    it("other address can help user get reward. ", async function(){
      await mintAndDepsitIntoVault(user, baseERC20, vault, assetAmount);
      assert.equal(await baseERC20.balanceOf(vault.address), assetAmount);

      await mintRewardAndNotify(snx, longERC20, assetAmount, admin);
      await passTime(86400);

      assert.equal(await longERC20.balanceOf(user), 0);
      await snx.getAllRewardsFor(user, {from: user2});

      approxBN(assetAmount, await longERC20.balanceOf(user), 3, true);
    });

  });

});


describe("Wrapped Long in SNX", function(){

  let accounts;
  let admin;
  let proxyAdmin;
  let user;
  let user2;

  let store;
  let vault;
  let vaultImplmentation;
  let baseERC20;
  let longERC20;
  let scLong;

  let snx;
  let assetAmount;

  before(async function() {
    accounts = await web3.eth.getAccounts();
    admin = accounts[1];
    user = accounts[2];
    proxyAdmin = accounts[3];
    user2 = accounts[4];
    vaultImplmentation = await VaultUpgradeable.new();
    storageImplementation = await StorageV1Upgradeable.new();
  });

  beforeEach(async function() {
    baseERC20 = await MockERC20.new("base", "BASED");
    longERC20 = await MockERC20.new("long", "LONGED");

    store = await deploy.store(admin, proxyAdmin);
    scLong = await deploy.selfCompoundingYield(store.address, longERC20.address, admin, proxyAdmin);

    [vault, snx] = await deploy.vaultWithMsnx(
      store.address, 
      baseERC20.address, 
      longERC20.address,
      admin, 
      proxyAdmin,
      "1000000000000" + "0".repeat(18),
      86400,
      scLong.address // self compounding set non zero address, 
    );

    await vault.setLongSelfCompounding(scLong.address, {from: admin});
    await scLong.addWhitelistDeposit(accounts[9], {from: admin});
    assetAmount = "1000" + "0".repeat(18);
  });

  async function mintAndDepsitIntoVault(_user, _baseAsset, _vault, _assetAmount){
    await _baseAsset.mint(_user, _assetAmount);
    await _baseAsset.approve(_vault.address, _assetAmount, {from: _user});
    await _vault.deposit(_assetAmount, {from: _user});
  }

  async function mintScRewardAndNotify(_pool, _reward, _amount, _scReward, _rewardDistribution){
    await _reward.mint(accounts[9], _amount);
    await _reward.approve(_scReward.address, _amount, {from: accounts[9]});
    await _scReward.deposit(_amount, {from: accounts[9]});
    let scRewardBalance = (await _scReward.balanceOf(accounts[9])).toString();
    await _scReward.transfer(_pool.address, scRewardBalance, {from: accounts[9]});
    await _pool.notifyTargetRewardAmount(_scReward.address, scRewardBalance, {from: _rewardDistribution});
  }

  describe("SNX pool", function() {
    it("one person stake and get reward", async function(){
      await mintAndDepsitIntoVault(user, baseERC20, vault, assetAmount);

      assert.equal(await baseERC20.balanceOf(vault.address), assetAmount);
      assert.equal(await vault.balanceOf(user), assetAmount);

      await mintScRewardAndNotify(snx, longERC20, assetAmount, scLong, admin);

      await passTime(86400);

      assert.equal(await longERC20.balanceOf(user), 0);
      await snx.getAllRewards({from: user});
      console.log((await longERC20.balanceOf(user)).toString());
      console.log((await scLong.balanceOf(user)).toString());

      approxBN(assetAmount, await longERC20.balanceOf(user), 5);
    });
  });
});