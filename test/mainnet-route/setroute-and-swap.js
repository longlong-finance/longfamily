var path = require('path');
if(process.env.RUNNING_COVERAGE) {
  var scriptName = path.basename(__filename);
  console.log("  Skipping " + scriptName);
  return ;
}

const SwapCenter = artifacts.require("SwapCenter");
const MockERC20 = artifacts.require("MockERC20");
const IERC20 = artifacts.require("IERC20");
const addresses = require("../../mainnet_info/deploymentAddresses.js");

const deploy = require("../helpers/deploy.js");

const { time, expectRevert, balance, BN, send, constants } = require('@openzeppelin/test-helpers');
const { assert, use } = require('chai');
const { impersonate, resetToBlock} = require("../helpers/blockchain-helpers.js");

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

  let sushiHolder = "0x80845058350b8c3df5c3015d8a717d64b3bf9267";
  let farmHolder = "0x19762b3b0Fe9b4d4Bd16eFA242CD1f3bCD5fa57C";
  let oneInchHolder = "0xF977814e90dA44bFA03b6295A0616a897441aceC"
  let usdcHolder = "0xF977814e90dA44bFA03b6295A0616a897441aceC";
  let usdn3CRVHolder = "0xc354c702513d5984ef77bc3d1974cfb3fdac3134";

  before(async function() {
    await resetToBlock(12900133);
    await impersonate([sushiHolder]);
    await impersonate([farmHolder]);
    await impersonate([oneInchHolder]);
    await impersonate([usdcHolder]);
    await impersonate([usdn3CRVHolder]);
    
    accounts = await web3.eth.getAccounts();
    admin = "0xca113e3be8efa4cd592c6ea7678dd7b7eb201e4d";
    await impersonate([admin]);
    user = accounts[2];
    proxyAdmin = accounts[3];
    etherGiver = accounts[4];

    swapCenter = await SwapCenter.at("0x676971096af637b196f6501818ae8d9c14eba56b");
  });

  describe("Swap Center on mainnet fork", function() {


    before(async function() {
      // drain ETH in contract
      await send.ether(etherGiver, admin, "1000000000000000000"); // 1ETH
      await swapCenter.rescueETH(admin, {from: admin});
    });

    async function obtainAssetFor(target, whale, tokenAddress, amount) {
        await impersonate([whale]);
        let token = await IERC20.at(tokenAddress);
        await send.ether(etherGiver, whale, "1000000000000000000"); // 1ETH
        await token.transfer(target, amount, {from: whale});
    }


    it("Swap X to Y", async function(){

        let x = "0x4f3e8f405cf5afc05d68142f3783bdfe13811522";
        let y = "0x06325440d014e39736583c165c2963ba99faf14e";

        // initiate instance
        let x_contract = await IERC20.at(x);
        let y_contract = await IERC20.at(y);

        // blocknumber 12900133
        let xHolder = "0xf0edea44dc3e83cda1892058d22f349814c40179";

        // Configure Route in our swapcenter
        // await swapCenter.setRoute(
        //     addresses.crvUSDN,
        //     addresses.crvStETH,
        //     [7, 7, 6, constants.MAX_UINT256, 2, 8],
        //     [
        //         [addresses.crvUSDN, addresses.crv3Curve],
        //         [addresses.crv3Curve, addresses.usdc],
        //         [addresses.usdc, addresses.weth],
        //         [addresses.weth, addresses.eth],
        //         [addresses.eth, addresses.stETH],
        //         [addresses.stETH, addresses.crvStETH]
        //     ],
        //     {from: admin}
        // );
        
        await swapCenter.setRoute(
            addresses.crvUSDN,
            addresses.crvStETH,
            [7, 0, 8],
            [
                [addresses.crvUSDN, addresses.usdn],
                [addresses.usdn, addresses.weth, addresses.stETH],
                [addresses.stETH, addresses.crvStETH]
            ],
            {from: admin}
        );

        await swapCenter.setOneInchPool(addresses.eth, addresses.stETH,"0xaa8adbdd94824e5c381ca4a262762945b353359f", {from: admin});

        // asset to swap
        let assetAmount = "1000" + "0".repeat(18);

        // obtain assets from asset holders
        await obtainAssetFor(user, xHolder, x, assetAmount);

        // start swapping
        await x_contract.approve(swapCenter.address, assetAmount, {from: user});
        tx = await swapCenter.swapExactTokenIn(x, y, assetAmount, 0, {from: user});
        
        console.log(tx);

        let yBalance = await y_contract.balanceOf(user);
        
        console.log("gas consumed: ", tx.receipt.gasUsed);
        console.log("yBalance:     ", yBalance.toString());
        assert.notEqual("0", yBalance.toString());
    });

  });


});
