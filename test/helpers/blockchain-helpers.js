const { time } = require('@openzeppelin/test-helpers');
const keys = require("../../key-management");

async function impersonate(accounts) {
  await hre.network.provider.request({
    method: "hardhat_impersonateAccount",
    params: accounts
  });
}

async function resetToBlock(blockNum){
  await hre.network.provider.request({
    method: "hardhat_reset",
    params: [{
      forking: {
        jsonRpcUrl: "https://eth-mainnet.alchemyapi.io/v2/" + keys.alchemyKey,
        blockNumber: blockNum
      }
    }]
  })
}

async function passTime(_time){
  await time.increase(_time);
  await time.advanceBlock();
}

module.exports = {
  impersonate,
  resetToBlock,
  passTime
};
