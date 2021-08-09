
const TimelockProxy = artifacts.require("TimelockProxy");
const VaultUpgradeable = artifacts.require("VaultUpgradeable");
const StorageV1Upgradeable = artifacts.require("StorageV1Upgradeable");
const MockERC20 = artifacts.require("MockERC20");

const { time, expectRevert } = require('@openzeppelin/test-helpers');
const { BN } = require('@openzeppelin/test-helpers/src/setup');

const deploy = require("../helpers/deploy.js")

describe("Vault basic", function(){

  let accounts;
  let admin;
  let proxyAdmin;
  let user;

  let store;
  let vault;
  let vaultImplmentation;
  let baseERC20;
  let longERC20;

  before(async function() {
    accounts = await web3.eth.getAccounts();
    admin = accounts[1];
    user = accounts[2];
    proxyAdmin = accounts[3];
  });

  beforeEach(async function() {
    baseERC20 = await MockERC20.new("base", "BASED");
    longERC20 = await MockERC20.new("long", "LONGED");
    store = await deploy.store(admin, proxyAdmin);
    [vault, snx] = await deploy.vaultWithMsnx(store.address, baseERC20.address, longERC20.address, admin, proxyAdmin,  "1" + "000000000000000000");
    await vault.setWihdrawFeeParameter(
      100, // withdrawFeeRatio  100/10000 = 1/100 = 1%
      86400 * 7, // 7 days
      86400 * 7 * 3, // waived on the 4th week
      {from: admin}
    );
  });

  describe("Vault deposit", function() {
    it("Vault initialize correctly", async function(){

      console.log(await vault.name());
      console.log(await vault.symbol());

      assert.equal(await vault.baseAsset(), baseERC20.address);
      assert.equal(await vault.longAsset(), longERC20.address);
      assert.equal(await vault.depositCap(), "1" + "000000000000000000");
      assert.equal(await vault.vaultDepositEnabled(), true);
      assert.equal(await vault.governance(), admin);
    });

    it("Vault cannot be reinitialized again", async function(){
      await expectRevert.unspecified(vault.initialize(store.address, baseERC20.address, longERC20.address, "1" + "000000000000000000"));
    });

    it("User deposits and withdraws (funds not pushed)", async function(){

      let assetAmount = "1000000";
      await baseERC20.mint(user, assetAmount);
      await baseERC20.approve(vault.address, assetAmount, {from: user});
      await vault.deposit(assetAmount, {from: user});

      assert.equal(await baseERC20.balanceOf(vault.address), assetAmount);
      assert.equal(await vault.balanceOf(user), assetAmount);

      // before 1st week: 1% => 10000
      assert.equal(
        (await vault.withdrawlFeePending(user)).toString(),
        "10000"
      );

      // before 2nd week: 0.5% (every week, it decays to half) => 5000
      await time.increase(86400 * 7);
      assert.equal(
        (await vault.withdrawlFeePending(user)).toString(),
        "5000"
      );

      // before 3rd week: 0.25%
      await time.increase(86400 * 7);
      assert.equal(
        (await vault.withdrawlFeePending(user)).toString(),
        "2500"
      );

      // 4th week: 0 fee
      await time.increase(86400 * 7);

      await vault.withdraw(assetAmount, {from: user});
      assert.equal(await baseERC20.balanceOf(vault.address), "0");
      assert.equal(await baseERC20.balanceOf(user), assetAmount);
    });

    it("Test withdraw fee calculation.", async function(){
      let assetAmount = "1000000";
      let halfAssetAmount = new BN("500000");
      await baseERC20.mint(user, assetAmount);
      await baseERC20.approve(vault.address, assetAmount, {from: user});
      await vault.deposit(assetAmount, {from: user});

      assert.equal(await baseERC20.balanceOf(vault.address), assetAmount);
      assert.equal(await vault.balanceOf(user), assetAmount);

      // before 1st week: 1% => 10000
      assert.equal(
        (await vault.withdrawlFeePending(user)).toString(),
        "10000"
      );

      // before 2nd week: 0.5% (every week, it decays to half) => 5000
      await time.increase(86400 * 7);
      assert.equal(
        (await vault.withdrawlFeePending(user)).toString(),
        "5000"
      );


      await vault.withdraw(halfAssetAmount, {from: user});
      assert.equal(await baseERC20.balanceOf(vault.address), halfAssetAmount.toString());
      //half of the withdraw is apply
      assert.equal(await baseERC20.balanceOf(user), halfAssetAmount.sub(new BN("2500")).toString());
      
      assert.equal(
        (await vault.withdrawlFeePending(user)).toString(),
        "2500"
      );

      await time.increase(86400 * 7);
      assert.equal(
        (await vault.withdrawlFeePending(user)).toString(),
        "1250"
      );
      
    
    });

  });

});