var path = require('path');
if(process.env.RUNNING_COVERAGE) {
  var scriptName = path.basename(__filename);
  console.log("  Skipping " + scriptName);
  return ;
}

const SwapCenter = artifacts.require("SwapCenter");
const MockERC20 = artifacts.require("MockERC20");
const IERC20 = artifacts.require("IERC20");

const deploy = require("./helpers/deploy.js");

const { time, expectRevert, balance, BN } = require('@openzeppelin/test-helpers');
const { assert, use } = require('chai');
const { impersonate, resetToBlock} = require("./helpers/blockchain-helpers.js");

describe("Swap basic", function(){

  let accounts;
  let admin;
  let proxyAdmin;
  let user;

  let swapCenter;
  let sushi = "0x6B3595068778DD592e39A122f4f5a5cF09C90fE2";
  let weth = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
  let usdc = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
  let farm = "0xa0246c9032bC3A600820415aE600c6388619A14D";
  let ifarm = "0x1571eD0bed4D987fe2b498DdBaE7DFA19519F651";
  let xsushi = "0x8798249c2E607446EfB7Ad49eC89dD1865Ff4272";
  let oneInch = "0x111111111117dC0aa78b770fA6A738034120C302";
  let eth_address = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"
  let usdn3CRV = "0x4f3E8F405CF5aFC05D68142F3783bDfE13811522";
  let threeCRV = "0x6c3f90f043a72fa612cbac8115ee7e52bde6e490";

  before(async function() {
    await resetToBlock(12519355);
    accounts = await web3.eth.getAccounts();
    admin = accounts[1];
    user = accounts[2];
    proxyAdmin = accounts[3];

    swapCenter = await SwapCenter.new({from: admin});
  });

  describe("Swap Center", function() {
    it("add route", async function(){
      await swapCenter.setRoute(
        sushi,
        usdc,
        [1, 0],
        [
          [sushi, weth],
          [weth, usdc]
        ], {from: admin}
      );

      let path = await swapCenter.getPath(sushi, usdc);

      let exchangeOrder = await swapCenter.getExchangeOrder(sushi, usdc);
    });

    it("add routes in batch", async function(){
      await swapCenter.setRouteBatch(
        [sushi],
        [usdc],
        [[1, 0]],
        [[
          [sushi, weth],
          [weth, usdc]
        ]], {from: admin}
      );

      let path = await swapCenter.getPath(sushi, usdc);
      let exchangeOrder = await swapCenter.getExchangeOrder(sushi, usdc);
    });
  });

  describe("Swap Center on mainnet fork", function() {

    let sushiHolder = "0x80845058350b8c3df5c3015d8a717d64b3bf9267";
    let farmHolder = "0x19762b3b0Fe9b4d4Bd16eFA242CD1f3bCD5fa57C";
    let oneInchHolder = "0xF977814e90dA44bFA03b6295A0616a897441aceC"
    let usdcHolder = "0xF977814e90dA44bFA03b6295A0616a897441aceC";
    let usdn3CRVHolder = "0xc354c702513d5984ef77bc3d1974cfb3fdac3134";

    before(async function() {
      await impersonate([sushiHolder]);
      await impersonate([farmHolder]);
      await impersonate([oneInchHolder]);
      await impersonate([usdcHolder]);
      await impersonate([usdn3CRVHolder]);

      // drain ETH in contract
      await swapCenter.rescueETH(admin, {from: admin});

    });


    it("Swap SUSHI to USDC (Uniswap and sushiswap)", async function(){
      await swapCenter.setRoute(
        sushi,
        usdc,
        [1, 0],
        [
          [sushi, weth],
          [weth, usdc]
        ], {from: admin}
      );

      let sushiContract = await IERC20.at(sushi);
      let usdcContract = await IERC20.at(usdc);
      let oneThousand = "1000" + "0".repeat(18);
      assert.notEqual("0", await sushiContract.balanceOf(sushiHolder));
      await usdcContract.transfer(user, await usdcContract.balanceOf(sushiHolder), {from: sushiHolder});
      assert.equal("0", await usdcContract.balanceOf(sushiHolder));

      await sushiContract.approve(swapCenter.address, oneThousand, {from: sushiHolder});
      await swapCenter.swapExactTokenIn(sushi, usdc, oneThousand, 0, {from: sushiHolder});

      let usdcBalance = await usdcContract.balanceOf(sushiHolder);
      assert.notEqual("0", usdcBalance.toString());
    });

    it("Swap USDC to 1INCH (Using 1inch AMM)", async function(){
      await swapCenter.setRoute(
        usdc,
        oneInch,
        [2],
        [
          [usdc, oneInch],
        ], {from: admin}
      );
      await swapCenter.setRoute(
        oneInch,
        usdc,
        [2],
        [
          [oneInch, usdc],
        ], {from: admin}
      );

      await swapCenter.setOneInchPool(oneInch, usdc,"0x69AB07348F51c639eF81d7991692f0049b10D522", {from: admin});

      let oneInchContract = await IERC20.at(oneInch);
      let usdcContract = await IERC20.at(usdc);
      let oneThousand = "1000" + "0".repeat(18);

      // clear usdc and 1inch token
      await usdcContract.transfer(admin, await usdcContract.balanceOf(user), {from: user});
      await oneInchContract.transfer(admin, await oneInchContract.balanceOf(user), {from: user});

      assert.equal("0", await oneInchContract.balanceOf(user));
      assert.equal("0", await usdcContract.balanceOf(user));

      await oneInchContract.transfer(user, oneThousand, {from: oneInchHolder});
      assert.equal(oneThousand, await oneInchContract.balanceOf(user));
      console.log("oneinch:" + await oneInchContract.balanceOf(user));


      await oneInchContract.approve(swapCenter.address, oneThousand, {from: user});
      await swapCenter.swapExactTokenIn(oneInch, usdc, oneThousand, 0, {from: user});
      assert.notEqual("0", await usdcContract.balanceOf(user));
      assert.equal("0", await oneInchContract.balanceOf(user));

      let balanceUSDC = await usdcContract.balanceOf(user);

      await usdcContract.approve(swapCenter.address, balanceUSDC, {from: user});
      await swapCenter.swapExactTokenIn(usdc, oneInch, balanceUSDC, 0, {from: user});
      assert.notEqual("0", await oneInchContract.balanceOf(user));
      assert.equal("0", await usdcContract.balanceOf(user));

    });

    it("Swap SUSHI to USDC (Using 1inch Aggregator)", async function(){
      await swapCenter.setRoute(
        sushi,
        usdc,
        [3, 3],
        [
          [sushi, weth],
          [weth, usdc]
        ], {from: admin}
      );

      let sushiContract = await IERC20.at(sushi);
      let usdcContract = await IERC20.at(usdc);
      let oneThousand = "1000" + "0".repeat(18);

      await usdcContract.transfer(user, await usdcContract.balanceOf(sushiHolder), {from: sushiHolder});
      assert.equal("0", await usdcContract.balanceOf(sushiHolder));

      await sushiContract.approve(swapCenter.address, oneThousand, {from: sushiHolder});
      await swapCenter.swapExactTokenIn(sushi, usdc, oneThousand, 0, {from: sushiHolder});

      let usdcBalance = await usdcContract.balanceOf(sushiHolder);
      assert.notEqual("0", usdcBalance.toString());
      console.log(usdcBalance.toString());
    });


    it("Convert between FARM and iFARM", async function(){
      await swapCenter.setRoute(
        farm,
        ifarm,
        [4],
        [
          [farm, ifarm],
        ], {from: admin}
      );

      await swapCenter.setRoute(
        ifarm,
        farm,
        [4],
        [
          [ifarm, farm],
        ], {from: admin}
      );

      let farmContract = await IERC20.at(farm);
      let ifarmContract = await IERC20.at(ifarm);

      await farmContract.transfer(user, await farmContract.balanceOf(farmHolder), {from: farmHolder});
      assert.notEqual("0", await farmContract.balanceOf(user));

      let balanceFarm = await farmContract.balanceOf(user);

      await farmContract.approve(swapCenter.address, balanceFarm, {from: user});
      await swapCenter.swapExactTokenIn(farm, ifarm, balanceFarm, 0, {from: user});
      assert.notEqual("0", await ifarmContract.balanceOf(user));
      assert.equal("0", await farmContract.balanceOf(user));

      let balanceIFarm = await ifarmContract.balanceOf(user);

      await ifarmContract.approve(swapCenter.address, balanceIFarm, {from: user});
      await swapCenter.swapExactTokenIn(ifarm, farm, balanceIFarm, 0, {from: user});
      assert.notEqual("0", await farmContract.balanceOf(user));
      assert.equal("0", await ifarmContract.balanceOf(user));

    });

    it("Convert between SUSHI and XSUSHI", async function(){
      await swapCenter.setRoute(
        sushi,
        xsushi,
        [5],
        [
          [sushi, xsushi],
        ], {from: admin}
      );

      await swapCenter.setRoute(
        xsushi,
        sushi,
        [5],
        [
          [xsushi, sushi],
        ], {from: admin}
      );

      let sushiContract = await IERC20.at(sushi);
      let xsushiContract = await IERC20.at(xsushi);

      await sushiContract.transfer(user, await sushiContract.balanceOf(sushiHolder), {from: sushiHolder});
      assert.notEqual("0", await sushiContract.balanceOf(user));

      let balanceSushi = await sushiContract.balanceOf(user);

      await sushiContract.approve(swapCenter.address, balanceSushi, {from: user});
      await swapCenter.swapExactTokenIn(sushi, xsushi, balanceSushi, 0, {from: user});
      assert.notEqual("0", await xsushiContract.balanceOf(user));
      assert.equal("0", await sushiContract.balanceOf(user));

      let balanceXSushi = await xsushiContract.balanceOf(user);

      await xsushiContract.approve(swapCenter.address, balanceXSushi, {from: user});
      await swapCenter.swapExactTokenIn(xsushi, sushi, balanceXSushi, 0, {from: user});
      assert.notEqual("0", await sushiContract.balanceOf(user));
      assert.equal("0", await xsushiContract.balanceOf(user));

    });

    it("Convert between ETH and WETH", async function(){
      await swapCenter.setRoute(
        eth_address,
        weth,
        ["0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"],
        [
          [eth_address, weth],
        ], {from: admin}
      );

      await swapCenter.setRoute(
        weth,
        eth_address,
        ["0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"],
        [
          [weth, eth_address],
        ], {from: admin}
      );

      let wethContract = await IERC20.at(weth);

      let amount = "10000";

      // ETH to WETH
      assert.equal("0", await wethContract.balanceOf(user));
      console.log(swapCenter.address);
      console.log( (await balance.current(swapCenter.address)).toString() );
      balanceBeforeConversion = await balance.current(user);
      await swapCenter.swapExactTokenIn(eth_address, weth, amount, 0, {from:user, value:amount, gasPrice:0});
      assert.equal(amount, (await wethContract.balanceOf(user)).toString());
      balanceAfterConversion = await balance.current(user);

//      assert.equal(amount, )

      // WETH to ETH
      wethContract = await IERC20.at(weth);
      await wethContract.approve(swapCenter.address, amount, {from: user, gasPrice:0});
      await swapCenter.swapExactTokenIn(weth, eth_address, amount, 0, {from:user, gasPrice:0});
      assert.equal(0, await wethContract.balanceOf(user));
      balanceAfterConvertingBack = await balance.current(user);

      assert.equal(balanceBeforeConversion.toString(), balanceAfterConvertingBack.toString());
    });


    it("Swap ETH to 1INCH (Using 1inch AMM)", async function(){
      await swapCenter.setRoute(
        eth_address,
        oneInch,
        [2],
        [
          [eth_address, oneInch],
        ], {from: admin}
      );
      await swapCenter.setRoute(
        oneInch,
        eth_address,
        [2],
        [
          [oneInch, eth_address],
        ], {from: admin}
      );

      await swapCenter.setOneInchPool(oneInch, eth_address,"0x0EF1B8a0E726Fc3948E15b23993015eB1627f210", {from: admin});

      let oneInchContract = await IERC20.at(oneInch);

      // clear 1inch token
      await oneInchContract.transfer(admin, await oneInchContract.balanceOf(user), {from: user});

      let amount = "10000";
      assert.equal("0", await oneInchContract.balanceOf(user));
      balanceBeforeConversion = await balance.current(user);
      await swapCenter.swapExactTokenIn(eth_address, oneInch, amount, 0, {from:user, value:amount, gasPrice:0});
      assert.notEqual("0", await oneInchContract.balanceOf(user));

      // Swap 1INCH to ETH
      oneInchAmount = await oneInchContract.balanceOf(user);
      await oneInchContract.approve(swapCenter.address, oneInchAmount.toString(), {from: user, gasPrice:0});
      await swapCenter.swapExactTokenIn(oneInch, eth_address, oneInchAmount, 0, {from:user, gasPrice:0});
      balanceAfterConveringBack = await balance.current(user);
      assert.equal(0, await oneInchContract.balanceOf(user));

      assert.approximately((
        (new BN(balanceBeforeConversion)).sub(balanceAfterConveringBack)).toNumber(),
        0, 200
      );
    });

    it("Convert between USDC and WETH (Uniswap v3)", async function(){
      await swapCenter.setRoute(
        usdc,
        weth,
        [6],
        [
          [usdc, weth],
        ], {from: admin}
      );

      await swapCenter.setRoute(
        weth,
        usdc,
        [6],
        [
          [weth, usdc],
        ], {from: admin}
      );
      // Use medium fee by default.
      assert.equal("3000", await swapCenter.getUniV3Fee(usdc, weth));
      assert.equal("3000", await swapCenter.getUniV3Fee(weth, usdc));
      await swapCenter.setUniV3Fee(usdc, weth, 500, {from: admin});
      assert.equal("500", await swapCenter.getUniV3Fee(usdc, weth));
      assert.equal("500", await swapCenter.getUniV3Fee(weth, usdc));

      let usdcContract = await IERC20.at(usdc);
      let wethContract = await IERC20.at(weth);

      let amount = 100000;

      // clear user account
      await usdcContract.transfer(usdcHolder, await usdcContract.balanceOf(user), {from: user});
      assert.equal("0", await usdcContract.balanceOf(user));
      await wethContract.transfer(admin, await wethContract.balanceOf(user), {from: user});
      assert.equal("0", await wethContract.balanceOf(user));

      // transfer usdc to user
      await usdcContract.transfer(user, amount, {from: usdcHolder});

      let balanceUSDC = await usdcContract.balanceOf(user);
      assert.equal(amount, balanceUSDC);

      // swap usdc for weth
      await usdcContract.approve(swapCenter.address, balanceUSDC, {from: user});
      await swapCenter.swapExactTokenIn(usdc, weth, balanceUSDC, 0, {from: user});
      assert.notEqual("0", await wethContract.balanceOf(user));
      assert.equal("0", await usdcContract.balanceOf(user));

      let balanceWETH = await wethContract.balanceOf(user);

      // swap weth for usdc
      await wethContract.approve(swapCenter.address, balanceWETH, {from: user});
      await swapCenter.swapExactTokenIn(weth, usdc, balanceWETH, 0, {from: user});
      assert.notEqual("0", await usdcContract.balanceOf(user));
      assert.equal("0", await wethContract.balanceOf(user));

    });


    it("Curve Remove liquidity form usdn3CRV pool.", async function(){
      await swapCenter.setRoute(
        usdn3CRV,
        usdc,
        [7, 7],
        [
          [usdn3CRV, threeCRV],
          [threeCRV, usdc]
        ], {from: admin}
      );

      await swapCenter.setRoute(
        usdc,
        usdn3CRV,
        [8, 8],
        [
          [usdc, threeCRV],
          [threeCRV, usdn3CRV]
        ], {from: admin}
      );


      let usdcContract = await IERC20.at(usdc);
      let usdn3CRVContract = await IERC20.at(usdn3CRV);
      
      assert.notEqual("0", await usdcContract.balanceOf("0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7"));

      // clear user account
      await usdcContract.transfer(usdcHolder, await usdcContract.balanceOf(user), {from: user});
      assert.equal("0", await usdcContract.balanceOf(user));

      let amount = "1000" + "0".repeat(18); 

      // transfer usdn3CRV to user
      await usdn3CRVContract.transfer(user, amount, {from: usdn3CRVHolder});
      
      assert.equal(
        await usdn3CRVContract.balanceOf(user),
        amount
      );

      await usdn3CRVContract.approve(swapCenter.address, amount, {from: user});
      await swapCenter.swapExactTokenIn(usdn3CRV, usdc, amount, 0, {from: user});
      
      console.log("await usdcContract.balanceOf(user)", (await usdcContract.balanceOf(user)).toString());
      assert.notEqual("0", await usdcContract.balanceOf(user));
      assert.equal("0", await usdn3CRVContract.balanceOf(user));


      let usdcBalance = await usdcContract.balanceOf(user);
      await usdcContract.approve(swapCenter.address, usdcBalance, {from: user});
      await swapCenter.swapExactTokenIn(usdc, usdn3CRV, usdcBalance, 0, {from: user});
      
      assert.equal("0", await usdcContract.balanceOf(user));
      assert.notEqual("0", await usdn3CRVContract.balanceOf(user));

      console.log("usdn3CRVContract.balanceOf(user)", (await usdn3CRVContract.balanceOf(user)).toString());

    });


    it("Deposit to vault.", async function(){
      let baseERC20 = await MockERC20.new("base", "BASED");
      let longERC20 = await MockERC20.new("long", "LONGED");
      let store = await deploy.store(admin, proxyAdmin);
      [vault, snx] = await deploy.vaultWithMsnx(store.address, baseERC20.address, longERC20.address, admin, proxyAdmin,  "1" + "000000000000000000");

      await swapCenter.setRoute(
        baseERC20.address,
        vault.address,
        ["0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe"],
        [
          [baseERC20.address, vault.address]
        ], {from: admin}
      );
      
      let amount = "1000" + "0".repeat(18); 
      await baseERC20.mint(user, amount);

      assert.equal(amount, await baseERC20.balanceOf(user));
      
      await baseERC20.approve(swapCenter.address, amount, {from: user});
      await swapCenter.swapExactTokenIn(baseERC20.address, vault.address, amount, 0, {from: user});
      
      assert.equal("0", await baseERC20.balanceOf(user));
      assert.equal(amount, await vault.balanceOf(user));

    });

  });


});
