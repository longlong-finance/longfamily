require("@nomiclabs/hardhat-waffle");
require("@nomiclabs/hardhat-web3");
require("@nomiclabs/hardhat-truffle5");
require("hardhat-deploy");
require("solidity-coverage");
require("hardhat-gas-reporter");
require("@nomiclabs/hardhat-etherscan");

keys = require("./key-management");

// This is a sample Hardhat task. To learn how to create your own go to
// https://hardhat.org/guides/create-task.html
task("accounts", "Prints the list of accounts", async () => {
  const accounts = await ethers.getSigners();

  for (const account of accounts) {
    console.log(account.address);
  }
});

// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more

/**
 * @type import('hardhat/config').HardhatUserConfig
 */
module.exports = {
  solidity: {
    version: "0.7.6",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      }
    }
  },
  networks: {
    hardhat: {
      forking: {
        url: "https://eth-mainnet.alchemyapi.io/v2/" + keys.alchemyKey,
        // blockNumber: 12304074
      },
      accounts: {
        mnemonic: keys.secret.mnemonic,
      },
      hardfork: "berlin"
    },
    mockSystem: {
      url: "http://127.0.0.1:8545/"
    },
    testnet: {
      url: "https://eth-rinkeby.alchemyapi.io/v2/" + keys.alchemyTestnetKey,
      accounts: {
        mnemonic: keys.secret.mnemonic,
      },
      gasPrice: 1000000000,
      gasLimit: 12450000,
    },
    mainnet: {
      url: "https://eth-mainnet.alchemyapi.io/v2/" + keys.alchemyKey,
      accounts: {
        mnemonic: keys.secret.mnemonic,
      },
      gasPrice: 45000000000,
      gasLimit: 5450000,
    }
  },
  gasReporter: {
    coinmarketcap: keys.coinMarketCapKey,
    currency: 'USD',
    gasPrice: 50
  },
  mocha: {
    timeout: 200000000
  },
  etherscan: {
    // Your API key for Etherscan
    // Obtain one at https://etherscan.io/
    apiKey: ""
  }
};
